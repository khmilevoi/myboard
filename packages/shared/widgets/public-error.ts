export type PublicWidgetErrorOptions = {
  code: string
  publicMessage: string
  status?: number
  meta?: Record<string, unknown>
  cause?: unknown
}

/**
 * A handler-returned error that crosses widget dispatch verbatim: dispatch
 * returns it unwrapped and the HTTP envelope carries its code/message/meta to
 * the client. Anything else a handler returns or throws still collapses to the
 * internal_error envelope. `meta` must only ever contain already-public values.
 */
export class PublicWidgetError extends Error {
  readonly status: number
  readonly code: string
  readonly publicMessage: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ code, publicMessage, status = 400, meta, cause }: PublicWidgetErrorOptions) {
    super(`Public widget error: ${code}`, cause === undefined ? undefined : { cause })
    this.name = 'PublicWidgetError'
    this.status = status
    this.code = code
    this.publicMessage = publicMessage
    this.meta = meta
  }
}
