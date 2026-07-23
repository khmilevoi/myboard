import type { WidgetSecrets } from './secrets'

export type { WidgetSecrets } from './secrets'

export type BrowserTaskContext = {
  page: import('playwright').Page
  secrets: WidgetSecrets
  retainPageForRecovery(): void
}
