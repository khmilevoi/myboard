// @vitest-environment node
import type { Page, Response } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import {
  CloudflareProbeError,
  evidenceFromResponseText,
  isCloudflareChallenge,
  makeCloudflareEvidenceDetector,
  makeCloudflarePageDetector,
  type ChallengeEvidence,
} from './cloudflare'

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

type DomEvidence = Pick<
  ChallengeEvidence,
  'url' | 'title' | 'hasChallengeForm' | 'hasChallengePlatform' | 'hasChallengeContent'
>

function makePage(dom: Partial<DomEvidence>, options?: { evaluateError?: unknown }) {
  const evaluate = vi.fn(async () => {
    if (options?.evaluateError !== undefined) throw options.evaluateError
    return {
      url: baseEvidence.url,
      title: baseEvidence.title,
      hasChallengeForm: false,
      hasChallengePlatform: false,
      hasChallengeContent: false,
      ...dom,
    }
  })
  return { page: { evaluate } as unknown as Page, evaluate }
}

function makeResponse(
  status: number,
  headers: Record<string, string>,
  options?: { headersError?: unknown },
) {
  return {
    status: () => status,
    allHeaders: async () => {
      if (options?.headersError !== undefined) throw options.headersError
      return headers
    },
  } as unknown as Response
}

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

  // Cloudflare's "JS Detections" / Bot Fight Mode script is injected into
  // normally served pages too, not only interstitials, so the platform marker
  // alone must never classify a healthy origin as challenged.
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
  // The passport-checker widget never calls evidenceFromResponseText by
  // reference: it splices its *source text* (via Function.prototype.toString())
  // into a `new Function(...)` that runs inside Chromium via page.evaluate,
  // because Playwright serializes evaluate callbacks by source alone and cannot
  // close over a Node-side import. Every other test in this file calls the
  // function directly, which still resolves free identifiers (a hoisted
  // module-scope regex, an imported helper, ...) against this module's scope and
  // would pass even if the function stopped being self-contained. Reconstructing
  // it the way production does has no such scope to fall back on: a free
  // identifier makes this throw ReferenceError instead of silently succeeding.
  // Do NOT simplify this back into a direct call.
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

describe('makeCloudflarePageDetector', () => {
  it('combines DOM markers with response headers to report a challenge', async () => {
    const { page } = makePage({ title: 'Just a moment...' })
    const detector = makeCloudflarePageDetector(
      makeResponse(503, { server: 'cloudflare', 'cf-ray': 'fixture-ray' }),
    )
    expect(await detector(page)).toBe(true)
  })

  it('reports no challenge for a clean page and a clean response', async () => {
    const { page } = makePage({})
    const detector = makeCloudflarePageDetector(makeResponse(200, {}))
    expect(await detector(page)).toBe(false)
  })

  it('needs a Cloudflare-attributed response before a challenge status counts', async () => {
    const { page } = makePage({ hasChallengeContent: true })
    const detector = makeCloudflarePageDetector(makeResponse(503, { server: 'fixture' }))
    expect(await detector(page)).toBe(false)
  })

  it('treats a null navigation response as an absent status and no headers', async () => {
    const { page } = makePage({ hasChallengeContent: true })
    const detector = makeCloudflarePageDetector(null)
    expect(await detector(page)).toBe(false)
  })

  it('returns a probe error when the page evaluation rejects', async () => {
    const { page } = makePage({}, { evaluateError: new Error('evaluate failed') })
    const detector = makeCloudflarePageDetector(makeResponse(200, {}))
    const result = await detector(page)
    expect(result).toBeInstanceOf(CloudflareProbeError)
  })

  it('returns a probe error when reading response headers rejects', async () => {
    const { page } = makePage({})
    const detector = makeCloudflarePageDetector(
      makeResponse(200, {}, { headersError: new Error('headers failed') }),
    )
    expect(await detector(page)).toBeInstanceOf(CloudflareProbeError)
  })

  it('returns a probe error when the page rejects with a non-Error value', async () => {
    const { page } = makePage({}, { evaluateError: 'target closed' })
    const detector = makeCloudflarePageDetector(makeResponse(200, {}))
    expect(await detector(page)).toBeInstanceOf(CloudflareProbeError)
  })
})

describe('makeCloudflareEvidenceDetector', () => {
  it('classifies pre-collected evidence without touching the page', async () => {
    const { page, evaluate } = makePage({})
    const detector = makeCloudflareEvidenceDetector({ ...baseEvidence, hasChallengeForm: true })
    expect(await detector(page)).toBe(true)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('reports no challenge for clean evidence', async () => {
    const { page } = makePage({})
    expect(await makeCloudflareEvidenceDetector(baseEvidence)(page)).toBe(false)
  })
})
