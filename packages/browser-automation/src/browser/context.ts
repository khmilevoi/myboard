import type { WidgetSecrets } from './secrets'

export type { WidgetSecrets } from './secrets'

export type BrowserTaskContext = {
  // @ts-expect-error playwright is added in a later task
  page: import('playwright').Page
  secrets: WidgetSecrets
}
