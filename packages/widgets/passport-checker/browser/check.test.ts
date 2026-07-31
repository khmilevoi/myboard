// @vitest-environment node
import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import { UserInputProbeError, UserInputRequiredError } from 'browser-automation/user-input'
import type { ChallengeEvidence } from 'browser-automation/user-input/cloudflare'
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { makePassportCheckHandler, readPassportIdentity } from './check'
import { BrowserConfigurationError, UpstreamResponseError } from './errors'

function secrets(series: string | undefined, number: string | undefined): WidgetSecrets {
  return {
    read: (key) => (key === 'number' ? `${series}${number}` : undefined),
    has: (key) => series !== undefined && number !== undefined && key === 'number',
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

type SubmitAttempt = SubmitScenario | Error

type PageScenario = {
  navigationError?: Error
  navigationStatus?: number
  submissions?: SubmitAttempt[]
  /** Consumed in call order by context.detectUserInput. */
  escalations?: Array<UserInputProbeError | UserInputRequiredError | null>
}

const defaultSubmitBody = { kind: 'json', data: { status: 1, send_status_msg: 'ok' } } as const

function makeContext(scenario: PageScenario) {
  const escalations = [...(scenario.escalations ?? [])]
  const submissions = [...(scenario.submissions ?? [])]
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
  const evaluate = vi.fn(async (_fn: unknown, _input: unknown) => {
    const attempt: SubmitAttempt = submissions.shift() ?? {
      kind: 'response',
      ok: true,
      body: defaultSubmitBody,
    }
    if (attempt instanceof Error) throw attempt
    if (attempt.kind === 'network_error') return attempt
    return {
      kind: 'response',
      evidence: { ...baseEvidence, ...attempt.evidence },
      ok: attempt.ok ?? true,
      body: attempt.body ?? defaultSubmitBody,
    }
  })
  const context: BrowserTaskContext = {
    page: { goto, evaluate } as unknown as Page,
    secrets: secrets('АБ', '123456'),
    detectUserInput,
  }
  return { context, evaluate, goto, detectUserInput }
}

const handlerOptions = {
  checkerUrl: 'http://fixture.local/solutions/checker',
}

describe('passport check handler', () => {
  it('navigates once and submits ID card before international passport', async () => {
    const { context, evaluate, goto } = makeContext({
      submissions: [
        {
          kind: 'response',
          body: { kind: 'json', data: { status: 1, send_status_msg: 'ID ok' } },
        },
        {
          kind: 'response',
          body: { kind: 'json', data: { status: 2, send_status_msg: 'International ok' } },
        },
      ],
    })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toEqual({
      idCard: { kind: 'success', status: 1, send_status_msg: 'ID ok' },
      internationalPassport: {
        kind: 'success',
        status: 2,
        send_status_msg: 'International ok',
      },
    })
    expect(goto).toHaveBeenCalledTimes(1)
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(evaluate.mock.calls[0]?.[1]).toEqual({
      identity: { series: 'АБ', number: '123456' },
      fields: { service: '1', doc_1_select: '1' },
    })
    expect(evaluate.mock.calls[1]?.[1]).toEqual({
      identity: { series: 'АБ', number: '123456' },
      fields: { service: '2', doc_age: '0', doc_2_select: '1' },
    })
  })

  it('continues after a safe first-document failure', async () => {
    const { context, evaluate } = makeContext({
      submissions: [
        { kind: 'network_error' },
        {
          kind: 'response',
          body: { kind: 'json', data: { status: 2, send_status_msg: 'International ok' } },
        },
      ],
    })

    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toEqual({
      idCard: { kind: 'error', code: 'upstream_response' },
      internationalPassport: {
        kind: 'success',
        status: 2,
        send_status_msg: 'International ok',
      },
    })
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('preserves the first result when the second document fails safely', async () => {
    const { context } = makeContext({
      submissions: [
        {
          kind: 'response',
          body: { kind: 'json', data: { status: 1, send_status_msg: 'ID ok' } },
        },
        { kind: 'response', body: { kind: 'invalid_json' } },
      ],
    })

    await expect(makePassportCheckHandler(handlerOptions)({}, context)).resolves.toEqual({
      idCard: { kind: 'success', status: 1, send_status_msg: 'ID ok' },
      internationalPassport: { kind: 'error', code: 'invalid_checker_response' },
    })
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

  it('stops before the second submission when the first response requires user input', async () => {
    const escalation = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    const { context, evaluate } = makeContext({
      escalations: [null, escalation],
    })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalation)
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it('discards the first outcome when the second response requires user input', async () => {
    const escalation = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    const { context, evaluate } = makeContext({ escalations: [null, null, escalation] })

    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalation)
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  // The POST goes through fetch, so the DOM is still the ordinary checker form:
  // without a fresh navigation the human staring at noVNC has no challenge to
  // solve. The prepare hook is how the retained page gets one.
  it('asks for a page reload on both submission checks', async () => {
    const { context, detectUserInput } = makeContext({})
    await makePassportCheckHandler(handlerOptions)({}, context)

    expect(detectUserInput).toHaveBeenCalledTimes(3)
    expect(detectUserInput.mock.calls[0]?.[1]).toBeUndefined()
    for (const submissionOptions of [
      detectUserInput.mock.calls[1]?.[1],
      detectUserInput.mock.calls[2]?.[1],
    ]) {
      expect(typeof submissionOptions?.prepare).toBe('function')

      const goto = vi.fn(async () => null)
      await submissionOptions?.prepare?.({ goto } as unknown as Page)
      expect(goto).toHaveBeenCalledWith('http://fixture.local/solutions/checker', {
        waitUntil: 'domcontentloaded',
      })
    }
  })

  // Nothing above checks *which* detector goes to each call, only that both POST
  // calls receive prepare hooks — a handler that swapped the two detector factories between the
  // navigation and submission checks would leave every other test in this file
  // green. Told apart here by actual behaviour, not by identity: the page detector
  // reaches into the live page via page.evaluate; the evidence detector classifies
  // evidence already collected inside the page and never touches its page argument.
  it('passes a page-based detector to the navigation check', async () => {
    const { context, detectUserInput } = makeContext({})
    await makePassportCheckHandler(handlerOptions)({}, context)

    const navigationDetector = detectUserInput.mock.calls[0]?.[0]
    const fakeEvaluate = vi.fn(async () => ({}))
    await navigationDetector?.({ evaluate: fakeEvaluate } as unknown as Page)

    expect(fakeEvaluate).toHaveBeenCalled()
  })

  it.each([1, 2])(
    'passes an evidence-based detector to submission check %i, and it classifies a challenge as true',
    async (callIndex) => {
      const { context, detectUserInput } = makeContext({
        submissions: [
          { kind: 'response', ok: true, evidence: { hasChallengeForm: true } },
          { kind: 'response', ok: true, evidence: { hasChallengeForm: true } },
        ],
      })
      await makePassportCheckHandler(handlerOptions)({}, context)

      const submissionDetector = detectUserInput.mock.calls[callIndex]?.[0]
      // {} as Page has no evaluate at all: if this were secretly the page detector,
      // invoking it here would throw instead of resolving.
      await expect(submissionDetector?.({} as Page)).resolves.toBe(true)
    },
  )

  it.each([1, 2])(
    'passes an evidence-based detector to submission check %i, and it classifies a clean response as false',
    async (callIndex) => {
      const { context, detectUserInput } = makeContext({})
      await makePassportCheckHandler(handlerOptions)({}, context)

      const submissionDetector = detectUserInput.mock.calls[callIndex]?.[0]
      await expect(submissionDetector?.({} as Page)).resolves.toBe(false)
    },
  )

  it.each([
    [
      'first page evaluation rejection',
      [new Error('first evaluation failed'), { kind: 'response' }] as const,
      'idCard',
      'upstream_response',
    ],
    [
      'second page evaluation rejection',
      [{ kind: 'response' }, new Error('second evaluation failed')] as const,
      'internationalPassport',
      'upstream_response',
    ],
    [
      'first non-2xx response',
      [{ kind: 'response', ok: false }, { kind: 'response' }] as const,
      'idCard',
      'upstream_response',
    ],
    [
      'second invalid JSON response',
      [{ kind: 'response' }, { kind: 'response', body: { kind: 'invalid_json' } }] as const,
      'internationalPassport',
      'invalid_checker_response',
    ],
    [
      'first schema mismatch',
      [
        { kind: 'response', body: { kind: 'json', data: { status: '1', send_status_msg: 'bad' } } },
        { kind: 'response' },
      ] as const,
      'idCard',
      'invalid_checker_response',
    ],
    [
      'second identity echo',
      [
        { kind: 'response' },
        {
          kind: 'response',
          body: { kind: 'json', data: { status: 2, send_status_msg: 'passport АБ 123456' } },
        },
      ] as const,
      'internationalPassport',
      'invalid_checker_response',
    ],
    [
      'two simultaneous safe failures',
      [{ kind: 'network_error' }, { kind: 'response', body: { kind: 'invalid_json' } }] as const,
      'idCard',
      'upstream_response',
    ],
  ] as const)(
    'keeps safe %s failures public and redacted',
    async (_name, submissions, branch, code) => {
      const { context, evaluate } = makeContext({ submissions: [...submissions] })
      const result = await makePassportCheckHandler(handlerOptions)({}, context)
      if (result instanceof Error) throw result

      expect(result[branch]).toEqual({ kind: 'error', code })
      if (_name === 'two simultaneous safe failures') {
        expect(result.internationalPassport).toEqual({
          kind: 'error',
          code: 'invalid_checker_response',
        })
      }
      expect(evaluate).toHaveBeenCalledTimes(2)
      expect(JSON.stringify(result)).not.toContain('АБ')
      expect(JSON.stringify(result)).not.toContain('123456')
    },
  )

  it('wraps a Playwright navigation rejection as an upstream error', async () => {
    const { context } = makeContext({ navigationError: new Error('navigation failed') })
    const result = await makePassportCheckHandler(handlerOptions)({}, context)
    expect(result).toBeInstanceOf(UpstreamResponseError)
  })

  it.each([
    [[null, new UserInputProbeError({ cause: new Error('first probe failed') })], 1],
    [[null, null, new UserInputProbeError({ cause: new Error('second probe failed') })], 2],
  ] as const)('keeps a submission probe failure task-level', async (escalations, submitCount) => {
    const { context, evaluate } = makeContext({ escalations: [...escalations] })

    const result = await makePassportCheckHandler(handlerOptions)({}, context)

    expect(result).toBe(escalations.at(-1))
    expect(evaluate).toHaveBeenCalledTimes(submitCount)
  })
})
