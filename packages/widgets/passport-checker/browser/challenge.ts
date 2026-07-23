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
  const explicitMarker =
    /\/cdn-cgi\/challenge-platform/i.test(evidence.url) ||
    /just a moment|attention required/i.test(evidence.title) ||
    evidence.hasChallengeForm ||
    evidence.hasChallengePlatform
  if (explicitMarker) return true

  const cloudflareResponse =
    evidence.server?.toLowerCase().includes('cloudflare') === true || evidence.cfRay !== null
  return (
    evidence.status !== null &&
    challengeStatuses.has(evidence.status) &&
    cloudflareResponse &&
    evidence.hasChallengeContent
  )
}
