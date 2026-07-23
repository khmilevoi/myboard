import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { isCloudflareChallenge, type ChallengeEvidence } from './challenge'
import { makePassportCheckHandler, readPassportIdentity } from './check'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
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
})

describe('Cloudflare challenge classifier', () => {
  it.each([
    [{ ...baseEvidence, url: 'https://pasport.org.ua/cdn-cgi/challenge-platform/h/g' }],
    [{ ...baseEvidence, title: 'Just a moment...' }],
    [{ ...baseEvidence, hasChallengeForm: true }],
    [{ ...baseEvidence, hasChallengePlatform: true }],
    [
      {
        ...baseEvidence,
        status: 503,
        server: 'cloudflare',
        cfRay: 'fixture-ray',
        hasChallengeContent: true,
      },
    ],
  ])('accepts positive challenge evidence', (evidence) => {
    expect(isCloudflareChallenge(evidence)).toBe(true)
  })

  it.each([
    [{ ...baseEvidence, status: 403 }],
    [{ ...baseEvidence, status: 429 }],
    [{ ...baseEvidence, status: 503, server: 'fixture' }],
    [{ ...baseEvidence, status: 503, server: 'cloudflare', cfRay: 'fixture-ray' }],
  ])('does not treat status alone as a challenge', (evidence) => {
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })
})

type PageScenario = {
  navigationError?: Error
  submissionError?: Error
  navigationStatus?: number
  navigationHeaders?: Record<string, string>
  evidence?: Partial<ChallengeEvidence>
  submit?:
    | { kind: 'success'; data: unknown }
    | { kind: 'session_required' }
    | { kind: 'upstream_error'; status: number }
    | { kind: 'invalid_json' }
    | { kind: 'network_error' }
}

function makeContext(scenario: PageScenario) {
  const retainPageForRecovery = vi.fn()
  const goto = vi.fn(async () => {
    if (scenario.navigationError) throw scenario.navigationError
    const status = scenario.navigationStatus ?? 200
    return {
      status: () => status,
      ok: () => status >= 200 && status < 400,
      allHeaders: async () => scenario.navigationHeaders ?? {},
    } as unknown as Response
  })
  const evaluate = vi.fn(async (_fn: unknown, arg?: unknown) => {
    if (arg === undefined) return { ...baseEvidence, ...scenario.evidence }
    if (scenario.submissionError) throw scenario.submissionError
    return (
      scenario.submit ?? {
        kind: 'success',
        data: { status: 1, send_status_msg: 'ok' },
      }
    )
  })
  const context: BrowserTaskContext = {
    page: { goto, evaluate } as unknown as Page,
    secrets: secrets('АБ', '123456'),
    retainPageForRecovery,
  }
  return { context, evaluate, goto, retainPageForRecovery }
}

describe('passport check handler', () => {
  it('returns only the validated checker result after one submission', async () => {
    const { context, evaluate } = makeContext({
      submit: {
        kind: 'success',
        data: { status: 2, send_status_msg: 'valid', ignored: true },
      },
    })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)

    expect(result).toEqual({ status: 2, send_status_msg: 'valid' })
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('retains a navigation challenge without submitting', async () => {
    const { context, evaluate, retainPageForRecovery } = makeContext({
      evidence: { hasChallengeForm: true },
    })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: 'pi@myboard.local',
    })({}, context)

    expect(result).toBeInstanceOf(BrowserSessionRequiredError)
    expect(retainPageForRecovery).toHaveBeenCalledOnce()
    expect(evaluate).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ kind: 'upstream_error', status: 502 } as const, UpstreamResponseError],
    [{ kind: 'invalid_json' } as const, InvalidCheckerResponseError],
    [{ kind: 'network_error' } as const, UpstreamResponseError],
  ])('maps safe submission outcomes to domain errors', async (submit, ErrorType) => {
    const { context } = makeContext({ submit })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)
    expect(result).toBeInstanceOf(ErrorType)
  })

  it.each([
    ['navigation', { navigationError: new Error('navigation failed') }],
    ['submission', { submissionError: new Error('submission failed') }],
  ] as const)('wraps a Playwright %s rejection as an upstream error', async (_phase, scenario) => {
    const { context } = makeContext(scenario)
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)
    expect(result).toBeInstanceOf(UpstreamResponseError)
  })

  it('rejects schema mismatches and responses that echo document identity', async () => {
    for (const data of [
      { status: '1', send_status_msg: 'bad' },
      { status: 1, send_status_msg: 'passport АБ 123456' },
    ]) {
      const { context } = makeContext({ submit: { kind: 'success', data } })
      const result = await makePassportCheckHandler({
        checkerUrl: 'http://fixture.local/solutions/checker',
        recoverySshTarget: null,
      })({}, context)
      expect(result).toBeInstanceOf(InvalidCheckerResponseError)
      expect(JSON.stringify(result)).not.toContain('123456')
    }
  })
})
