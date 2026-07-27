import type { Page } from 'playwright'

import type { DetectUserInputOptions, UserInputDetector } from './detector'
import { UserInputProbeError, UserInputRequiredError } from './errors'

export type DetectUserInput = (
  detector: UserInputDetector,
  options?: DetectUserInputOptions,
) => Promise<UserInputProbeError | UserInputRequiredError | null>

/**
 * Builds the context's `detectUserInput`. Kept separate from the Chromium
 * executor so a caller that owns a page by other means — an integration test
 * driving a real Playwright page, a future non-Chromium executor — gets the same
 * semantics instead of reimplementing them.
 */
export function makeDetectUserInput(deps: {
  page: Page
  recoverySshTarget: string | null
  /** Real host noVNC port for this stack; UserInputRequiredError falls back
   *  to its own default when omitted. */
  novncPort?: number
  retain: () => void
}): DetectUserInput {
  return async (detector, options) => {
    // A detector may reject as well as return an Error, and a rejected
    // Playwright call can carry a non-Error value, so anything that is not a
    // boolean means the check could not be carried out. The page is left
    // unretained on purpose: an undecidable check is not a challenge.
    const detected: unknown = await detector(deps.page).catch((cause: unknown) => cause)
    if (typeof detected !== 'boolean') return new UserInputProbeError({ cause: detected })
    if (!detected) return null

    if (options?.prepare) {
      // The outcome is tagged by us rather than inferred from the settled
      // value, for the same reason the detector branch above tests
      // `typeof detected`: a rejection can carry anything, including whatever
      // sentinel a "did it fail?" comparison would have used. Rejecting with
      // exactly `null` must still be a failure.
      const prepared = await options
        .prepare(deps.page)
        .then(() => ({ failed: false }) as const)
        .catch((cause: unknown) => ({ failed: true, cause }) as const)
      if (prepared.failed) {
        console.warn('Failed to prepare the page for manual recovery', prepared.cause)
      }
    }

    deps.retain()
    return new UserInputRequiredError({
      sshTarget: deps.recoverySshTarget,
      novncPort: deps.novncPort,
    })
  }
}
