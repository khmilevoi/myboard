import type { Page } from 'playwright'

/**
 * Decides whether a browser task can continue without a human.
 *
 * Returns `true` when the task is blocked and someone must act on the live
 * page, `false` when it may continue, and an `Error` when the check itself
 * could not be carried out — a broken probe is not the same as "no challenge",
 * and the platform must not confuse the two.
 */
export type UserInputDetector = (page: Page) => Promise<Error | boolean>

export type DetectUserInputOptions = {
  /**
   * Runs only after the detector matched, before the page is retained. Use it
   * to leave the retained page in a state a human can act on. A failure here is
   * logged and does not cancel the escalation.
   */
  prepare?: (page: Page) => Promise<unknown>
}
