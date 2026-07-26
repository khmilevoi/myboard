import type { HttpLike } from '@shared/http/client'
import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'
import * as errore from 'errore'
import { z } from 'zod'

const WidgetApiEnvelopeSchema = z.union([
  z.object({ data: z.unknown() }),
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
      meta: z.record(z.string(), z.unknown()).optional(),
    }),
  }),
])

type WidgetApiErrorOptions = {
  reason: string
  code: string
  meta?: Record<string, unknown>
  cause?: unknown
}

export class WidgetApiError extends errore.createTaggedError({
  name: 'WidgetApiError',
  message: 'Widget API request failed: $reason',
}) {
  readonly code: string
  readonly meta: Record<string, unknown> | undefined

  constructor({ code, meta, ...options }: WidgetApiErrorOptions) {
    super(options)
    this.code = code
    this.meta = meta
  }
}

export type MakeWidgetApiOptions = {
  typeId: string
  instanceId: string
  http: HttpLike
}

export function makeWidgetApi<Events extends WidgetEventMap>({
  typeId,
  instanceId,
  http,
}: MakeWidgetApiOptions): WidgetApi<Events, WidgetApiError> {
  return {
    async invoke<Event extends keyof Events & string>(
      event: Event,
      payload: Events[Event]['payload'],
    ): Promise<WidgetApiError | Events[Event]['result']> {
      const url = `/api/widgets/${encodeURIComponent(typeId)}/${encodeURIComponent(event)}`
      const response = await http.post(url, { json: { instanceId, payload } })
      if (response instanceof Error) {
        return new WidgetApiError({
          reason: 'network request failed',
          code: 'network',
          cause: response,
        })
      }

      const envelope = WidgetApiEnvelopeSchema.safeParse(response.body)
      if (!envelope.success) {
        return new WidgetApiError({
          reason: 'response envelope is invalid',
          code: 'invalid_response',
          cause: envelope.error,
        })
      }
      if ('error' in envelope.data) {
        return new WidgetApiError({
          reason: `${envelope.data.error.code}: ${envelope.data.error.message}`,
          code: envelope.data.error.code,
          meta: envelope.data.error.meta,
        })
      }
      if (!response.ok) {
        return new WidgetApiError({ reason: `HTTP ${response.status}`, code: 'invalid_response' })
      }

      return envelope.data.data as Events[Event]['result']
    },
  }
}
