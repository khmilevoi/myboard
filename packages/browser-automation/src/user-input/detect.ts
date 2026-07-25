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
      const prepared = await options
        .prepare(deps.page)
        .then(() => null)
        .catch((cause: unknown) => cause)
      if (prepared !== null) {
        console.warn('Failed to prepare the page for manual recovery', prepared)
      }
    }

    deps.retain()
    return new UserInputRequiredError({ sshTarget: deps.recoverySshTarget })
  }
}
