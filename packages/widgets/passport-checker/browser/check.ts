import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import {
  evidenceFromResponseText,
  makeCloudflareEvidenceDetector,
  makeCloudflarePageDetector,
  type ChallengeEvidence,
} from 'browser-automation/user-input/cloudflare'
import * as errore from 'errore'

import {
  passportCheckResultSchema,
  type PassportCheckPayload,
  type PassportCheckResult,
} from '../types'
import {
  BrowserConfigurationError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'
import {z} from "zod";

const passportNumberRegExp = /^(?<series>[АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ]{2})(?<number>[0-9]{6})$/

export const passportIdentitySchema = z.object({
  series: z.string(),
  number: z.string()
})
export type PassportIdentity = z.Infer<typeof passportIdentitySchema>

export function readPassportIdentity(secrets: WidgetSecrets) {
  const passportNumber = errore.try({
    try: () => secrets.read('number'),
    catch: () => new BrowserConfigurationError(),
  })
  if (passportNumber instanceof Error) return passportNumber
  if(!passportNumber) return new BrowserConfigurationError()

  const match = passportNumberRegExp.exec(passportNumber.trim())

  if(!match || !match.groups) return new BrowserConfigurationError()
  const numberResult = passportIdentitySchema.safeParse(match.groups);
  if(!numberResult.success) return new BrowserConfigurationError()
  const {series, number} = numberResult.data

  if (!series || !number) return new BrowserConfigurationError()
  if (!passportNumberRegExp.test(passportNumber)) return new BrowserConfigurationError()
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
}

function containsIdentity(result: PassportCheckResult, identity: PassportIdentity) {
  return (
    result.send_status_msg.includes(identity.series) ||
    result.send_status_msg.includes(identity.number)
  )
}

// Playwright serializes a page.evaluate callback by source text alone — it
// cannot close over a Node-side import (see the docstring on
// evidenceFromResponseText in browser-automation/user-input/cloudflare.ts).
// Passing the composed source as a *string* pageFunction does not work either: verified
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

    const navigationEscalation = await context.detectUserInput(
      makeCloudflarePageDetector(navigation),
    )
    if (navigationEscalation instanceof Error) return navigationEscalation

    if (navigation && !navigation.ok()) {
      return new UpstreamResponseError({ phase: 'navigation', status: navigation.status() })
    }

    const outcome = await submitPassport(context, identity)
    if (outcome instanceof Error) return outcome
    if (outcome.kind === 'network_error') {
      return new UpstreamResponseError({ phase: 'submission' })
    }

    // The POST went through fetch, so the page still shows the ordinary checker
    // form and a human in the noVNC stream would have nothing to solve. The
    // prepare hook re-navigates so the retained page carries the real challenge;
    // it runs only if the detector matched, and its failure does not cancel the
    // escalation.
    const submissionEscalation = await context.detectUserInput(
      makeCloudflareEvidenceDetector(outcome.evidence),
      { prepare: (page) => page.goto(options.checkerUrl, { waitUntil: 'domcontentloaded' }) },
    )
    if (submissionEscalation instanceof Error) return submissionEscalation

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
