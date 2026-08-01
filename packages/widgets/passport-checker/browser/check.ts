import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import {
  evidenceFromResponseText,
  makeCloudflareEvidenceDetector,
  makeCloudflarePageDetector,
  type ChallengeEvidence,
} from 'browser-automation/user-input/cloudflare'
import * as errore from 'errore'
import { z } from 'zod'

import {
  passportServiceResponseSchema,
  type PassportCheckPayload,
  type PassportCheckResult,
  type PassportDocumentResult,
  type PassportServiceResponse,
} from '../types'
import {
  BrowserConfigurationError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

const passportNumberRegExp =
  /^(?<series>[АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯ]{2})(?<number>[0-9]{6})$/

export const passportIdentitySchema = z.object({
  series: z.string(),
  number: z.string(),
})
export type PassportIdentity = z.Infer<typeof passportIdentitySchema>

export function readPassportIdentity(secrets: WidgetSecrets) {
  const passportNumber = errore.try({
    try: () => secrets.read('number'),
    catch: () => new BrowserConfigurationError(),
  })
  if (passportNumber instanceof Error) return passportNumber
  if (!passportNumber) return new BrowserConfigurationError()

  const match = passportNumberRegExp.exec(passportNumber.trim())

  if (!match || !match.groups) return new BrowserConfigurationError()
  const numberResult = passportIdentitySchema.safeParse(match.groups)
  if (!numberResult.success) return new BrowserConfigurationError()
  const { series, number } = numberResult.data

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

type PassportRequestDefinition = {
  fields: Readonly<Record<string, string>>
}

const PASSPORT_REQUESTS = {
  idCard: {
    fields: { service: '1', doc_1_select: '1' },
  },
  internationalPassport: {
    fields: { service: '2', doc_age: '0', doc_2_select: '1' },
  },
} as const satisfies Record<'idCard' | 'internationalPassport', PassportRequestDefinition>

type SubmitPassportInput = {
  identity: PassportIdentity
  fields: Readonly<Record<string, string>>
}

export type PassportCheckHandlerOptions = {
  checkerUrl: string
}

function containsIdentity(result: PassportServiceResponse, identity: PassportIdentity) {
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
  `return (async ({ identity, fields }) => {
    const evidenceFromResponseText = ${evidenceFromResponseText.toString()}

    const formData = new FormData()
    for (const [key, value] of Object.entries(fields)) formData.set(key, value)
    formData.set('doc_1_series', identity.series)
    formData.set('doc_1_number6', identity.number)

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
)() as (input: SubmitPassportInput) => Promise<SubmitOutcome>

async function submitPassport({
  context,
  identity,
  request,
}: {
  context: BrowserTaskContext
  identity: PassportIdentity
  request: PassportRequestDefinition
}): Promise<UpstreamResponseError | SubmitOutcome> {
  return context.page
    .evaluate<SubmitOutcome, SubmitPassportInput>(submitPassportInPage, {
      identity,
      fields: request.fields,
    })
    .catch((cause) => new UpstreamResponseError({ phase: 'submission', cause }))
}

async function checkDocument({
  context,
  identity,
  request,
  checkerUrl,
}: {
  context: BrowserTaskContext
  identity: PassportIdentity
  request: PassportRequestDefinition
  checkerUrl: string
}): Promise<Error | PassportServiceResponse> {
  const outcome = await submitPassport({ context, identity, request })
  if (outcome instanceof Error) return outcome
  if (outcome.kind === 'network_error') return new UpstreamResponseError({ phase: 'submission' })

  // The POST went through fetch, so the page still shows the ordinary checker
  // form and a human in the noVNC stream would have nothing to solve. The
  // prepare hook re-navigates so the retained page carries the real challenge;
  // it runs only if the detector matched, and its failure does not cancel the
  // escalation.
  const escalation = await context.detectUserInput(
    makeCloudflareEvidenceDetector(outcome.evidence),
    { prepare: (page) => page.goto(checkerUrl, { waitUntil: 'domcontentloaded' }) },
  )
  if (escalation instanceof Error) return escalation
  if (!outcome.ok) {
    return new UpstreamResponseError({
      phase: 'submission',
      status: outcome.evidence.status ?? undefined,
    })
  }
  if (outcome.body.kind === 'invalid_json') return new InvalidCheckerResponseError()

  const parsed = passportServiceResponseSchema.safeParse(outcome.body.data)
  if (!parsed.success) return new InvalidCheckerResponseError()
  if (containsIdentity(parsed.data, identity)) return new InvalidCheckerResponseError()
  return parsed.data
}

async function preparePassportCheck(
  context: BrowserTaskContext,
  options: PassportCheckHandlerOptions,
) {
  const identity = readPassportIdentity(context.secrets)
  if (identity instanceof Error) return identity

  const navigation = await context.page
    .goto(options.checkerUrl, { waitUntil: 'domcontentloaded' })
    .catch((cause) => new UpstreamResponseError({ phase: 'navigation', cause }))
  if (navigation instanceof Error) return navigation

  const navigationEscalation = await context.detectUserInput(makeCloudflarePageDetector(navigation))
  if (navigationEscalation instanceof Error) return navigationEscalation

  if (navigation && !navigation.ok()) {
    return new UpstreamResponseError({ phase: 'navigation', status: navigation.status() })
  }
  return identity
}

async function checkDocumentV2(options: Parameters<typeof checkDocument>[0]) {
  const result = await checkDocument(options)
  if (result instanceof UpstreamResponseError) {
    return { kind: 'error', code: 'upstream_response' } as const
  }
  if (result instanceof InvalidCheckerResponseError) {
    return { kind: 'error', code: 'invalid_checker_response' } as const
  }
  if (result instanceof Error) return result
  return { kind: 'success', ...result } as const satisfies PassportDocumentResult
}

export function makeLegacyPassportCheckHandler(options: PassportCheckHandlerOptions) {
  return async (_payload: PassportCheckPayload, context: BrowserTaskContext) => {
    const identity = await preparePassportCheck(context, options)
    if (identity instanceof Error) return identity

    return checkDocument({
      context,
      identity,
      request: PASSPORT_REQUESTS.idCard,
      checkerUrl: options.checkerUrl,
    })
  }
}

export function makePassportCheckHandler(options: PassportCheckHandlerOptions) {
  return async (_payload: PassportCheckPayload, context: BrowserTaskContext) => {
    const identity = await preparePassportCheck(context, options)
    if (identity instanceof Error) return identity

    const idCard = await checkDocumentV2({
      context,
      identity,
      request: PASSPORT_REQUESTS.idCard,
      checkerUrl: options.checkerUrl,
    })
    if (idCard instanceof Error) return idCard

    const internationalPassport = await checkDocumentV2({
      context,
      identity,
      request: PASSPORT_REQUESTS.internationalPassport,
      checkerUrl: options.checkerUrl,
    })
    if (internationalPassport instanceof Error) return internationalPassport

    return { idCard, internationalPassport } satisfies PassportCheckResult
  }
}
