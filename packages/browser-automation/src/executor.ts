export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>
  release(context: Context): Promise<void>
  /**
   * Whether the widget has a page retained for manual recovery. A page closed
   * by Chromium or a context crash counts as absent and its entry is dropped.
   */
  hasRetainedPage(widgetId: string): boolean
  shutdown(): Promise<void>
}
