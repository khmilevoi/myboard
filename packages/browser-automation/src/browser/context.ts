import type { DetectUserInput } from '../user-input/detect'
import type { WidgetSecrets } from './secrets'

export type { WidgetSecrets } from './secrets'
export type { DetectUserInputOptions, UserInputDetector } from '../user-input/detector'

export type BrowserTaskContext = {
  page: import('playwright').Page
  secrets: WidgetSecrets
  retainPageForRecovery(): void
  /**
   * Runs `detector` against the page. On a match it prepares the page (if a
   * prepare hook was given), retains it for manual recovery, and returns the
   * canonical error — one indivisible step, so a handler cannot retain a page
   * without escalating or escalate without retaining.
   */
  detectUserInput: DetectUserInput
}
