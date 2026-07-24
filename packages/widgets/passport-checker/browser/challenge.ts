export type ChallengeEvidence = {
  url: string
  title: string
  status: number | null
  server: string | null
  cfRay: string | null
  hasChallengeForm: boolean
  hasChallengePlatform: boolean
  hasChallengeContent: boolean
}

const challengeStatuses = new Set([403, 503])

export function isCloudflareChallenge(evidence: ChallengeEvidence) {
  // Cloudflare's "JS Detections" / Bot Fight Mode script
  // (/cdn-cgi/challenge-platform/...) is injected into normally served pages
  // too, not only interstitials, so hasChallengePlatform alone must never be
  // treated as an explicit marker (see the docstring on evidenceFromResponseText
  // for the fixture that motivated this). It only counts alongside a
  // challenge-shaped status and a Cloudflare-attributed response, below.
  const explicitMarker =
    /\/cdn-cgi\/challenge-platform/i.test(evidence.url) ||
    /just a moment|attention required/i.test(evidence.title) ||
    evidence.hasChallengeForm
  if (explicitMarker) return true

  const cloudflareResponse =
    evidence.server?.toLowerCase().includes('cloudflare') === true || evidence.cfRay !== null
  return (
    evidence.status !== null &&
    challengeStatuses.has(evidence.status) &&
    cloudflareResponse &&
    (evidence.hasChallengeContent || evidence.hasChallengePlatform)
  )
}

export type EvidenceFromResponseTextInput = {
  url: string
  status: number
  server: string | null
  cfRay: string | null
  text: string | null
}

// Derives ChallengeEvidence from a checker response's raw text/headers. This
// function is pure and intentionally self-contained: no references to
// anything outside its own parameters, no closures over module-level consts,
// no DOM/Node APIs. That is what lets browser/check.ts's submitPassport splice
// this function's compiled source (via Function.prototype.toString()) into the
// same page.evaluate() argument that performs the same-origin POST, instead of
// calling it by reference — Playwright serializes evaluate callbacks by source
// text alone and cannot close over a Node-side import. Splicing keeps the
// exact code that runs in-page identical to the code exercised directly by the
// evidenceFromResponseText unit tests in browser/check.test.ts, and it never
// requires the raw response text to leave the page.
export function evidenceFromResponseText({
  url,
  status,
  server,
  cfRay,
  text,
}: EvidenceFromResponseTextInput): ChallengeEvidence {
  // Requires an actual closing </title> tag (not merely the next '<' of any
  // kind), so a <title occurrence inside a script literal or comment with no
  // real closing tag of its own cannot match. The captured text is then
  // trimmed and capped at 200 characters so an unusually large title cannot
  // carry unbounded page text back into Node.
  const titleMatch = text === null ? null : /<title[^>]*>([^<]*)<\/title>/i.exec(text)
  return {
    url,
    title: titleMatch ? titleMatch[1].trim().slice(0, 200) : '',
    status,
    server,
    cfRay,
    hasChallengeForm:
      text !== null &&
      (/id=["']?challenge-form["']?/i.test(text) ||
        /<form[^>]+action=["'][^"']*challenge[^"']*["']/i.test(text)),
    hasChallengePlatform:
      text !== null &&
      /<script[^>]+src=["'][^"']*\/cdn-cgi\/challenge-platform\/[^"']*["']/i.test(text),
    hasChallengeContent: text !== null && /cf-chl-|challenge-platform/i.test(text),
  }
}
