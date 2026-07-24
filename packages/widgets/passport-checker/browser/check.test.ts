import type { BrowserTaskContext, WidgetSecrets } from 'browser-automation/task-context'
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  evidenceFromResponseText,
  isCloudflareChallenge,
  type ChallengeEvidence,
} from './challenge'
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

describe('Cloudflare challenge classifier', () => {
  it.each([
    [{ ...baseEvidence, url: 'https://pasport.org.ua/cdn-cgi/challenge-platform/h/g' }],
    [{ ...baseEvidence, title: 'Just a moment...' }],
    [{ ...baseEvidence, hasChallengeForm: true }],
    [
      {
        ...baseEvidence,
        status: 503,
        server: 'cloudflare',
        cfRay: 'fixture-ray',
        hasChallengeContent: true,
      },
    ],
    [
      {
        ...baseEvidence,
        status: 503,
        server: 'cloudflare',
        cfRay: 'fixture-ray',
        hasChallengePlatform: true,
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

  // Item 1 fix: Cloudflare's "JS Detections" / Bot Fight Mode script is
  // injected into normally served pages too, not only interstitials. Before
  // the fix, hasChallengePlatform alone (via baseEvidence's 200/no-server/
  // no-cfRay shape) was treated as an explicit marker and this returned true,
  // which would have permanently misclassified a healthy checker origin that
  // happens to run JSD/Bot Fight Mode. Previously this exact fixture lived in
  // the "accepts positive challenge evidence" list above; it has moved here.
  it('does not classify a 200 page carrying only the JS Detections/Bot Fight Mode script as a challenge', () => {
    expect(isCloudflareChallenge({ ...baseEvidence, hasChallengePlatform: true })).toBe(false)
  })
})

describe('evidenceFromResponseText', () => {
  it('does not classify a 200 body carrying only the JS Detections/Bot Fight Mode script as a challenge', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '<!doctype html><head><script src="/cdn-cgi/challenge-platform/h/g/jsd/r2.js"></script></head><body>ready</body>',
    })
    expect(evidence.hasChallengePlatform).toBe(true)
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })

  it('extracts a bounded title and both challenge markers from a real challenge body', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      text: '<!doctype html><title>Just a moment...</title><div id="challenge-form" class="cf-chl-widget"></div>',
    })
    expect(evidence).toEqual({
      url: 'https://pasport.org.ua/solutions/checker',
      title: 'Just a moment...',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      hasChallengeForm: true,
      hasChallengePlatform: false,
      hasChallengeContent: true,
    })
    expect(isCloudflareChallenge(evidence)).toBe(true)
  })

  it('detects an unquoted id=challenge-form attribute', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      text: '<!doctype html><div id=challenge-form></div>',
    })
    expect(evidence.hasChallengeForm).toBe(true)
  })

  it('produces all-false evidence and an empty title for a plain JSON success body', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '{"status":1,"send_status_msg":"ok"}',
    })
    expect(evidence).toEqual({
      url: 'https://pasport.org.ua/solutions/checker',
      title: '',
      status: 200,
      server: null,
      cfRay: null,
      hasChallengeForm: false,
      hasChallengePlatform: false,
      hasChallengeContent: false,
    })
    expect(isCloudflareChallenge(evidence)).toBe(false)
  })

  it('caps an oversized title at 200 characters instead of returning it unbounded', () => {
    const longTitle = 'A'.repeat(400)
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: `<title>${longTitle}</title>`,
    })
    expect(evidence.title).toBe('A'.repeat(200))
    expect(evidence.title.length).toBe(200)
  })

  it('does not take a <title occurrence with no matching close tag, such as inside a script literal', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '<script>var markup = "<title>fake";</script><title>Real Title</title>',
    })
    expect(evidence.title).toBe('Real Title')
  })

  it('returns all-false evidence with no title when the response has no text', () => {
    const evidence = evidenceFromResponseText({
      url: 'https://pasport.org.ua/solutions/checker',
      status: 502,
      server: null,
      cfRay: null,
      text: null,
    })
    expect(evidence).toEqual({
      url: 'https://pasport.org.ua/solutions/checker',
      title: '',
      status: 502,
      server: null,
      cfRay: null,
      hasChallengeForm: false,
      hasChallengePlatform: false,
      hasChallengeContent: false,
    })
  })
})

describe('evidenceFromResponseText spliced into a page callback', () => {
  // browser/check.ts never calls evidenceFromResponseText by reference: it
  // splices its *source text* (via Function.prototype.toString()) into a
  // `new Function(...)` that runs inside Chromium via page.evaluate — see the
  // docstring on evidenceFromResponseText in browser/challenge.ts and the
  // comment above submitPassportInPage in browser/check.ts. Every other test
  // in this file calls evidenceFromResponseText directly, which still
  // resolves free identifiers (a hoisted module-scope regex, an imported
  // helper, ...) against this test module's scope and would pass even if the
  // function were no longer self-contained. Reconstructing it exactly the
  // way production does has no such scope to fall back on: a free identifier
  // makes this throw ReferenceError instead of silently succeeding. Do NOT
  // simplify this back into a direct call — that would stop guarding the
  // actual page-callback splice production ships.
  const reconstructed = new Function(
    `return ${evidenceFromResponseText.toString()}`,
  )() as typeof evidenceFromResponseText

  it('reconstructs identically to the direct call for a real challenge body', () => {
    const input = {
      url: 'https://pasport.org.ua/solutions/checker',
      status: 503,
      server: 'cloudflare',
      cfRay: 'fixture-ray',
      text: '<!doctype html><title>Just a moment...</title><div id="challenge-form" class="cf-chl-widget"></div>',
    }
    expect(reconstructed(input)).toEqual(evidenceFromResponseText(input))
  })

  it('reconstructs identically to the direct call for a plain success body', () => {
    const input = {
      url: 'https://pasport.org.ua/solutions/checker',
      status: 200,
      server: null,
      cfRay: null,
      text: '{"status":1,"send_status_msg":"ok"}',
    }
    expect(reconstructed(input)).toEqual(evidenceFromResponseText(input))
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
  navigationHeaders?: Record<string, string>
  evidence?: Partial<ChallengeEvidence>
  submit?: SubmitScenario
}

const defaultSubmitBody = { kind: 'json', data: { status: 1, send_status_msg: 'ok' } } as const

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
    retainPageForRecovery,
  }
  return { context, evaluate, goto, retainPageForRecovery }
}

describe('passport check handler', () => {
  it('returns only the validated checker result after one submission', async () => {
    const { context, evaluate, retainPageForRecovery } = makeContext({
      submit: {
        kind: 'response',
        ok: true,
        body: { kind: 'json', data: { status: 2, send_status_msg: 'valid', ignored: true } },
      },
    })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)

    expect(result).toEqual({ status: 2, send_status_msg: 'valid' })
    expect(evaluate).toHaveBeenCalledTimes(2)
    expect(retainPageForRecovery).not.toHaveBeenCalled()
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
    [{ kind: 'response', ok: false, evidence: { status: 502 } } as const, UpstreamResponseError],
    [
      { kind: 'response', ok: true, body: { kind: 'invalid_json' } } as const,
      InvalidCheckerResponseError,
    ],
    [{ kind: 'network_error' } as const, UpstreamResponseError],
  ])('maps safe submission outcomes to domain errors', async (submit, ErrorType) => {
    const { context, retainPageForRecovery } = makeContext({ submit })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)
    expect(result).toBeInstanceOf(ErrorType)
    expect(retainPageForRecovery).not.toHaveBeenCalled()
  })

  it.each([
    ['navigation', { navigationError: new Error('navigation failed') }],
    ['submission', { submissionError: new Error('submission failed') }],
  ] as const)('wraps a Playwright %s rejection as an upstream error', async (_phase, scenario) => {
    const { context, retainPageForRecovery } = makeContext(scenario)
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: null,
    })({}, context)
    expect(result).toBeInstanceOf(UpstreamResponseError)
    expect(retainPageForRecovery).not.toHaveBeenCalled()
  })

  it('classifies a POST challenge with the shared classifier, retains the page, and never re-submits', async () => {
    const { context, evaluate, goto, retainPageForRecovery } = makeContext({
      submit: {
        kind: 'response',
        ok: false,
        evidence: { hasChallengeForm: true },
      },
    })
    const result = await makePassportCheckHandler({
      checkerUrl: 'http://fixture.local/solutions/checker',
      recoverySshTarget: 'pi@myboard.local',
    })({}, context)

    expect(result).toBeInstanceOf(BrowserSessionRequiredError)
    expect(retainPageForRecovery).toHaveBeenCalledOnce()
    expect(goto).toHaveBeenCalledTimes(2)
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('rejects schema mismatches and responses that echo document identity', async () => {
    for (const data of [
      { status: '1', send_status_msg: 'bad' },
      { status: 1, send_status_msg: 'passport АБ 123456' },
    ]) {
      const { context } = makeContext({
        submit: { kind: 'response', ok: true, body: { kind: 'json', data } },
      })
      const result = await makePassportCheckHandler({
        checkerUrl: 'http://fixture.local/solutions/checker',
        recoverySshTarget: null,
      })({}, context)
      expect(result).toBeInstanceOf(InvalidCheckerResponseError)
      expect(JSON.stringify(result)).not.toContain('123456')
    }
  })
})
