export type BrowserExecutor<Context> = {
  acquire(signal: AbortSignal, widgetId: string): Promise<Error | Context>
  release(context: Context): Promise<void>
  shutdown(): Promise<void>
}

// SP2 placeholder. Subproject 3 replaces this at the index.ts construction site
// with the persistent headed Chromium host.
export function makeStubExecutor(): BrowserExecutor<unknown> {
  return {
    async acquire() {
      return {}
    },
    async release() {},
    async shutdown() {},
  }
}
