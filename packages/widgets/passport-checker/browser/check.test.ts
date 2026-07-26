// @vitest-environment node
import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import { UserInputProbeError, UserInputRequiredError } from 'browser-automation/user-input'
import type { ChallengeEvidence } from 'browser-automation/user-input/cloudflare'
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { makePassportCheckHandler, readPassportIdentity } from './check'
import {
  BrowserConfigurationError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

function secrets(series: string | undefined, number: string | undefined): WidgetSecrets {
  return {
    read: (key) => (key === 'series' ? series : key === 'number' ? number : undefined),
    has: (key) => (key === 'series' ? series !== undefined : number !== undefined),
  }
}

const baseEvidence: ChallengeEvidence = {
  url: 'https://pasport.org.ua/solutions/checker',
  title: 'Checker',
  status: 200,
  server: null,
  cfRay: null,
  hasChallengeForm: false,
  hasChallengePlatform: false,
  hasChallengeContent: false,
}

describe('passport identity', () => {
  it.each([
    [undefined, '123456'],
    ['АБ', undefined],
    ['AB', '123456'],
    ['Аб', '123456'],
    ['АБ', '12345'],
    ['АБ', '１２３４５６'],
  ])('rejects absent or malformed secrets without echoing them', (series, number) => {
    const result = readPassportIdentity(secrets(series, number))
    expect(result).toBeInstanceOf(BrowserConfigurationError)
    expect(JSON.stringify(result)).not.toContain(series ?? 'missing-series')
    expect(JSON.stringify(result)).not.toContain(number ?? 'missing-number')
  })

  it('accepts two uppercase Ukrainian letters and six ASCII digits', () => {
    expect(readPassportIdentity(secrets('АБ', '123456'))).toEqual({
      series: 'АБ',
      number: '123456',
    })
  })

  it('treats a throwing secret read as a configuration error, not an unhandled rejection', () => {
    const throwingSecrets: WidgetSecrets = {
      read: () => {
        throw new Error('read failed')
      },
      has: () => false,
    }
    const result = readPassportIdentity(throwingSecrets)
    expect(result).toBeInstanceOf(BrowserConfigurationError)
  })
})

type SubmitScenario =
  | { kind: 'network_error' }
  | {
      kind: 'response'
      evidence?: Partial<ChallengeEvidence>
      ok?: boolean
      body?: { kind: 'json'; data: unknown } | { kind: 'invalid_json' }
    }

type PageScenario = {
  navigationError?: Error
  submissionError?: Error
  navigationStatus?: number
  submit?: SubmitScenario
  /** Consumed in call order by context.detectUserInput. */
  escalations?: Array<UserInputProbeError | UserInputRequiredError | null>
}

const defaultSubmitBody = { kind: 'json', data: { status: 1, send_status_msg: 'ok' } } as const

function makeContext(scenario: PageScenario) {
  const escalations = [...(scenario.escalations ?? [])]
  // Typed from the context member, not inferred: the tests below read
  // detectUserInput.mock.calls[n][1] to assert which options the handler passed,
  // and an inferred zero-argument mock would type those calls as empty tuples.
  const detectUserInput = vi.fn<BrowserTaskContext['detectUserInput']>(
    async () => escalations.shift() ?? null,
  )
  const goto = vi.fn(async () => {
    if (scenario.navigationError) throw scenario.navigationError
    const status = scenario.navigationStatus ?? 200
    return {
      status: () => status,
      ok: () => status >= 200 && status < 400,
      allHeaders: async () => ({}),
    } as unknown as Response
  })
  // The navigation evidence probe now lives behind detectUserInput, so the only
  // page.evaluate this handler still makes is the passport submission.
  const evaluate = vi.fn(async (_fn: unknown) => {
    if (scenario.submissionError) throw scenario.submissionError

    const submit: SubmitScenario = scenario.submit ?? {
      kind: 'response',
      ok: true,
      body: defaultSubmitBody,
    }
    if (submit.kind === 'network_error') return submit
    return {
      kind: 'response',
      evidence: { ...baseEvidence, ...submit.evidence },
      ok: submit.ok ?? true,
      body: submit.body ?? defaultSubmitBody,
    }
  })
  const context: BrowserTaskContext = {
    page: { goto, evaluate } as unknown as Page,
    secrets: secrets('АБ', '123456'),
    retainPageForRecovery: () => undefined,
    detectUserInput,
  }
  return { context, evaluate, goto, detectUserInput }
}

const handlerOptions = {
  checkerUrl: 'http://fixture.local/solutions/checker',
  recoverySshTarget: null,
}

describe('passport check handler', () => {
  it('returns only the validated checker result after one submission', async () => {
    const { context, evaluate, detectUserInput } = makeContext({
      submit: {
        kind: 'response',
        ok: true,
        body: { kind: 'json', data: { status: 2, send_status_msg: 'valid', ignored: true } },
      },
    })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toEqual({ status: 2, send_status_msg: 'valid' })
    expect(evaluate).toHaveBeenCalledTimes(1)
    expect(detectUserInput).toHaveBeenCalledTimes(2)
  })

  it('returns the navigation escalation without submitting', async () => {
    const escalation = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    const { context, evaluate } = makeContext({ escalations: [escalation] })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalation)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('returns a navigation probe failure without submitting', async () => {
    const probeFailure = new UserInputProbeError({ cause: new Error('evaluate failed') })
    const { context, evaluate } = makeContext({ escalations: [probeFailure] })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(probeFailure)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('returns the submission escalation and never re-submits', async () => {
    const escalation = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    const { context, evaluate } = makeContext({
      escalations: [null, escalation],
      submit: { kind: 'response', ok: false, evidence: { hasChallengeForm: true } },
    })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalation)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  // The POST goes through fetch, so the DOM is still the ordinary checker form:
  // without a fresh navigation the human staring at noVNC has no challenge to
  // solve. The prepare hook is how the retained page gets one.
  it('asks for a page reload only on the submission check', async () => {
    const { context, detectUserInput } = makeContext({})
    await makePassportCheckHandler(handlerOptions)({}, context)

    expect(detectUserInput.mock.calls[0]?.[1]).toBeUndefined()
    const submissionOptions = detectUserInput.mock.calls[1]?.[1]
    expect(typeof submissionOptions?.prepare).toBe('function')

    const goto = vi.fn(async () => null)
    await submissionOptions?.prepare?.({ goto } as unknown as Page)
    expect(goto).toHaveBeenCalledWith('http://fixture.local/solutions/checker', {
      waitUntil: 'domcontentloaded',
    })
  })

  it.each([
    [{ kind: 'response', ok: false, evidence: { status: 502 } } as const, UpstreamResponseError],
    [
      { kind: 'response', ok: true, body: { kind: 'invalid_json' } } as const,
      InvalidCheckerResponseError,
    ],
    [{ kind: 'network_error' } as const, UpstreamResponseError],
  ])('maps safe submission outcomes to domain errors', async (submit, ErrorType) => {
    const { context } = makeContext({ submit })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)
    expect(result).toBeInstanceOf(ErrorType)
  })

  it.each([
    ['navigation', { navigationError: new Error('navigation failed') }],
    ['submission', { submissionError: new Error('submission failed') }],
  ] as const)('wraps a Playwright %s rejection as an upstream error', async (_phase, scenario) => {
    const { context } = makeContext(scenario)
    const result = await makePassportCheckHandler(handlerOptions)({}, context)
    expect(result).toBeInstanceOf(UpstreamResponseError)
  })

  it('rejects schema mismatches and responses that echo document identity', async () => {
    for (const data of [
      { status: '1', send_status_msg: 'bad' },
      { status: 1, send_status_msg: 'passport АБ 123456' },
    ]) {
      const { context } = makeContext({
        submit: { kind: 'response', ok: true, body: { kind: 'json', data } },
      })
      const result = await makePassportCheckHandler(handlerOptions)({}, context)
      expect(result).toBeInstanceOf(InvalidCheckerResponseError)
      expect(JSON.stringify(result)).not.toContain('123456')
    }
  })
})
