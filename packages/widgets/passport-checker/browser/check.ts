import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import * as errore from 'errore'
import type { Response } from 'playwright'

import {
  passportCheckResultSchema,
  type PassportCheckPayload,
  type PassportCheckResult,
} from '../types'
import {
  evidenceFromResponseText,
  isCloudflareChallenge,
  type ChallengeEvidence,
} from './challenge'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

// These callbacks are serialized into Chromium by page.evaluate, so the browser
// globals exist at runtime. Declaring them module-locally keeps the DOM lib out of
// the Node-only browser-automation tsconfig, which compiles this file through the
// generated task registry (see packages/browser-automation/src/diagnostics.ts).
declare const window: { location: { href: string } }
declare const document: {
  title: string
  documentElement: { innerHTML: string }
  querySelector(selectors: string): unknown
}

const ukrainianPassportSeries = /^[АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ]{2}$/u
const passportNumber = /^[0-9]{6}$/

export type PassportIdentity = { series: string; number: string }

export function readPassportIdentity(secrets: WidgetSecrets) {
  const series = errore.try({
    try: () => secrets.read('series'),
    catch: () => new BrowserConfigurationError(),
  })
  if (series instanceof Error) return series

  const number = errore.try({
    try: () => secrets.read('number'),
    catch: () => new BrowserConfigurationError(),
  })
  if (number instanceof Error) return number

  if (!series || !number) return new BrowserConfigurationError()
  if (!ukrainianPassportSeries.test(series)) return new BrowserConfigurationError()
  if (!passportNumber.test(number)) return new BrowserConfigurationError()
  return { series, number } satisfies PassportIdentity
}

type SubmitOutcome =
  | { kind: 'network_error' }
  | {
      kind: 'response'
      evidence: ChallengeEvidence
      ok: boolean
      body: { kind: 'json'; data: unknown } | { kind: 'invalid_json' }
    }

export type PassportCheckHandlerOptions = {
  checkerUrl: string
  recoverySshTarget: string | null
}

async function collectNavigationEvidence(context: BrowserTaskContext, response: Response | null) {
  const pageEvidence = await context.page
    .evaluate(() => ({
      url: window.location.href,
      title: document.title,
      hasChallengeForm:
        document.querySelector('#challenge-form, form[action*="challenge"]') !== null,
      hasChallengePlatform:
        document.querySelector('script[src*="/cdn-cgi/challenge-platform/"]') !== null,
      hasChallengeContent: /cf-chl-|challenge-platform/i.test(document.documentElement.innerHTML),
    }))
    .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
  if (pageEvidence instanceof Error) return pageEvidence

  const headers = response
    ? await response
        .allHeaders()
        .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
    : {}
  if (headers instanceof Error) return headers

  return {
    ...pageEvidence,
    status: response?.status() ?? null,
    server: headers.server ?? null,
    cfRay: headers['cf-ray'] ?? null,
  } satisfies ChallengeEvidence
}

function containsIdentity(result: PassportCheckResult, identity: PassportIdentity) {
  return (
    result.send_status_msg.includes(identity.series) ||
    result.send_status_msg.includes(identity.number)
  )
}

// Playwright serializes a page.evaluate callback by source text alone — it
// cannot close over a Node-side import (see the docstring on
// evidenceFromResponseText in browser/challenge.ts). Passing the composed
// source as a *string* pageFunction does not work either: verified
// empirically against this Playwright version, a string pageFunction is only
// ever evaluated as a bare expression and the `arg` is never applied to it, so
// a function-typed completion value structured-clones to `undefined` instead
// of being called. Building a real, closure-free Function object with
// `new Function` here — entirely in Node, never inside the browser, so there
// is no page-CSP exposure — and handing Playwright *that* function object
// uses the same proven function+arg serialization path every other
// page.evaluate call in this file already relies on.
const submitPassportInPage = new Function(
  `return (async ({ series, number }) => {
    const evidenceFromResponseText = ${evidenceFromResponseText.toString()}

    const formData = new FormData()
    formData.set('service', '1')
    formData.set('doc_1_select', '1')
    formData.set('doc_1_series', series)
    formData.set('doc_1_number6', number)

    const response = await fetch('/solutions/checker', {
      method: 'POST',
      body: formData,
    }).catch(() => null)
    if (response === null) return { kind: 'network_error' }

    const text = await response.text().catch(() => null)
    const evidence = evidenceFromResponseText({
      url: response.url,
      status: response.status,
      server: response.headers.get('server'),
      cfRay: response.headers.get('cf-ray'),
      text,
    })

    const body = await Promise.resolve(text)
      .then((value) => {
        if (value === null) return { kind: 'invalid_json' }
        return { kind: 'json', data: JSON.parse(value) }
      })
      .catch(() => ({ kind: 'invalid_json' }))

    return { kind: 'response', evidence, ok: response.ok, body }
  })`,
)() as (identity: PassportIdentity) => Promise<SubmitOutcome>

async function submitPassport(
  context: BrowserTaskContext,
  identity: PassportIdentity,
): Promise<UpstreamResponseError | SubmitOutcome> {
  return context.page
    .evaluate<SubmitOutcome, PassportIdentity>(submitPassportInPage, identity)
    .catch((cause) => new UpstreamResponseError({ phase: 'submission', cause }))
}

export function makePassportCheckHandler(options: PassportCheckHandlerOptions) {
  return async (_payload: PassportCheckPayload, context: BrowserTaskContext) => {
    const identity = readPassportIdentity(context.secrets)
    if (identity instanceof Error) return identity

    const navigation = await context.page
      .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
      .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
    if (navigation instanceof Error) return navigation

    const evidence = await collectNavigationEvidence(context, navigation)
    if (evidence instanceof Error) return evidence
    if (isCloudflareChallenge(evidence)) {
      context.retainPageForRecovery()
      return new BrowserSessionRequiredError({ sshTarget: options.recoverySshTarget })
    }
    if (navigation && !navigation.ok()) {
      return new UpstreamResponseError({ phase: 'navigation', status: navigation.status() })
    }

    const outcome = await submitPassport(context, identity)
    if (outcome instanceof Error) return outcome
    if (outcome.kind === 'network_error') {
      return new UpstreamResponseError({ phase: 'submission' })
    }
    if (isCloudflareChallenge(outcome.evidence)) {
      const prepared = await context.page
        .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
        .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
      if (prepared instanceof Error)
        console.warn('Failed to prepare passport recovery page', prepared)
      context.retainPageForRecovery()
      return new BrowserSessionRequiredError({ sshTarget: options.recoverySshTarget })
    }
    if (!outcome.ok) {
      return new UpstreamResponseError({
        phase: 'submission',
        status: outcome.evidence.status ?? undefined,
      })
    }
    if (outcome.body.kind === 'invalid_json') return new InvalidCheckerResponseError()

    const parsed = passportCheckResultSchema.safeParse(outcome.body.data)
    if (!parsed.success) return new InvalidCheckerResponseError()
    if (containsIdentity(parsed.data, identity)) return new InvalidCheckerResponseError()
    return parsed.data
  }
}
