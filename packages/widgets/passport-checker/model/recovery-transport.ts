import * as errore from 'errore'
import { z } from 'zod'

const RecoveryIssueResponseSchema = z.object({ expiresInMs: z.number().int().positive() })

export type RecoveryIssue = z.output<typeof RecoveryIssueResponseSchema>

export type RecoveryIssueCode =
  | 'recovery_unavailable'
  | 'recovery_busy'
  | 'automation_unavailable'
  | 'network'
  | 'invalid_response'

type RecoveryIssueErrorOptions = { code: RecoveryIssueCode; cause?: unknown }

export class RecoveryIssueError extends errore.createTaggedError({
  name: 'RecoveryIssueError',
  message: 'Recovery issue failed with $code',
}) {
  declare readonly code: RecoveryIssueCode

  constructor(options: RecoveryIssueErrorOptions) {
    super(options)
  }
}

export type RecoveryTransport = {
  issue(widgetId: string): Promise<RecoveryIssueError | RecoveryIssue>
}

/**
 * Prod adapter for the Subproject 6 issue endpoint. The single-use capability
 * cookie is set by the response and rides the same-origin WS handshake
 * automatically — the token itself never crosses this interface.
 */
export function makeRecoveryTransport(fetchFn: typeof fetch = fetch): RecoveryTransport {
  return {
    async issue(widgetId) {
      const response = await fetchFn(`/api/browser/recovery/${encodeURIComponent(widgetId)}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'X-Requested-With': 'MyBoard' },
      }).catch((cause: unknown) => new RecoveryIssueError({ code: 'network', cause }))
      if (response instanceof Error) return response

      if (response.status === 404) return new RecoveryIssueError({ code: 'recovery_unavailable' })
      if (response.status === 409) return new RecoveryIssueError({ code: 'recovery_busy' })
      if (response.status === 503) return new RecoveryIssueError({ code: 'automation_unavailable' })
      if (!response.ok) return new RecoveryIssueError({ code: 'invalid_response' })

      const body = await (response.json() as Promise<Record<string, unknown>>).catch(
        (cause: unknown) => new RecoveryIssueError({ code: 'invalid_response', cause }),
      )
      if (body instanceof Error) return body

      const parsed = RecoveryIssueResponseSchema.safeParse(body)
      if (!parsed.success) {
        return new RecoveryIssueError({ code: 'invalid_response', cause: parsed.error })
      }
      return parsed.data
    },
  }
}
