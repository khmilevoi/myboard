export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>
  release(context: Context): Promise<void>
  shutdown(): Promise<void>
}
