import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import type { Response } from 'playwright'

import {
  passportCheckResultSchema,
  type PassportCheckPayload,
  type PassportCheckResult,
} from '../types'
import { isCloudflareChallenge, type ChallengeEvidence } from './challenge'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

const ukrainianPassportSeries = /^[АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ]{2}$/u
const passportNumber = /^[0-9]{6}$/

export type PassportIdentity = { series: string; number: string }

export function readPassportIdentity(secrets: WidgetSecrets) {
  const series = secrets.read('series')
  const number = secrets.read('number')
  if (!series || !number) return new BrowserConfigurationError()
  if (!ukrainianPassportSeries.test(series)) return new BrowserConfigurationError()
  if (!passportNumber.test(number)) return new BrowserConfigurationError()
  return { series, number } satisfies PassportIdentity
}

type SubmitOutcome =
  | { kind: 'success'; data: unknown }
  | { kind: 'session_required' }
  | { kind: 'upstream_error'; status: number }
  | { kind: 'invalid_json' }
  | { kind: 'network_error' }

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

async function submitPassport(
  context: BrowserTaskContext,
  identity: PassportIdentity,
): Promise<UpstreamResponseError | SubmitOutcome> {
  return context.page
    .evaluate(async ({ series, number }) => {
      const formData = new FormData()
      formData.set('service', '1')
      formData.set('doc_1_select', '1')
      formData.set('doc_1_series', series)
      formData.set('doc_1_number6', number)

      const response = await fetch('/solutions/checker', {
        method: 'POST',
        body: formData,
      }).catch(() => null)
      if (response === null) return { kind: 'network_error' } as const

      const text = await response.text().catch(() => null)
      if (text === null) return { kind: 'invalid_json' } as const

      const lower = text.toLowerCase()
      const cloudflareHeader =
        response.headers.get('server')?.toLowerCase().includes('cloudflare') === true ||
        response.headers.has('cf-ray')
      const challengeMarker =
        lower.includes('/cdn-cgi/challenge-platform/') ||
        lower.includes('id="challenge-form"') ||
        lower.includes('<title>just a moment')
      const challengeShapedContent = lower.includes('cf-chl-')
      if (
        challengeMarker ||
        ([403, 503].includes(response.status) && cloudflareHeader && challengeShapedContent)
      ) {
        return { kind: 'session_required' } as const
      }
      if (!response.ok) return { kind: 'upstream_error', status: response.status } as const

      return Promise.resolve(text)
        .then((value) => ({ kind: 'success', data: JSON.parse(value) as unknown }) as const)
        .catch(() => ({ kind: 'invalid_json' }) as const)
    }, identity)
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
    if (outcome.kind === 'session_required') {
      const prepared = await context.page
        .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
        .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
      if (prepared instanceof Error)
        console.warn('Failed to prepare passport recovery page', prepared)
      context.retainPageForRecovery()
      return new BrowserSessionRequiredError({ sshTarget: options.recoverySshTarget })
    }
    if (outcome.kind === 'network_error') {
      return new UpstreamResponseError({ phase: 'submission' })
    }
    if (outcome.kind === 'upstream_error') {
      return new UpstreamResponseError({ phase: 'submission', status: outcome.status })
    }
    if (outcome.kind === 'invalid_json') return new InvalidCheckerResponseError()

    const parsed = passportCheckResultSchema.safeParse(outcome.data)
    if (!parsed.success) return new InvalidCheckerResponseError()
    if (containsIdentity(parsed.data, identity)) return new InvalidCheckerResponseError()
    return parsed.data
  }
}
