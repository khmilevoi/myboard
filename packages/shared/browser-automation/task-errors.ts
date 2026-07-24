export class BrowserTaskError extends Error {
  code = 'internal'
  publicMessage = 'Browser task failed'
  get publicMeta(): Record<string, unknown> | undefined {
    return undefined
  }
}
