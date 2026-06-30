import * as errore from 'errore'
import { z } from 'zod'

import type { WidgetApi, WidgetEventMap } from '@shared/widgets/contracts'

const WidgetApiEnvelopeSchema = z.union([
  z.object({ data: z.unknown() }),
  z.object({
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
  }),
])

export class WidgetApiError extends errore.createTaggedError({
  name: 'WidgetApiError',
  message: 'Widget API request failed: $reason',
}) {}

export type MakeWidgetApiOptions = {
  typeId: string
  instanceId: string
  fetch?: typeof globalThis.fetch
}

export function makeWidgetApi<Events extends WidgetEventMap>({
  typeId,
  instanceId,
  fetch: fetchRequest = globalThis.fetch,
}: MakeWidgetApiOptions): WidgetApi<Events, WidgetApiError> {
  return {
    async invoke<Event extends keyof Events & string>(
      event: Event,
      payload: Events[Event]['payload'],
    ): Promise<WidgetApiError | Events[Event]['result']> {
      const body = errore.try(() => JSON.stringify({ instanceId, payload }))
      if (body instanceof Error) {
        return new WidgetApiError({ reason: 'request serialization failed', cause: body })
      }

      const url = `/api/widgets/${encodeURIComponent(typeId)}/${encodeURIComponent(event)}`
      const response = await fetchRequest(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }).catch((cause) => new WidgetApiError({ reason: 'network request failed', cause }))
      if (response instanceof Error) return response

      const raw = await (response.json() as Promise<unknown>).catch(
        (cause) => new WidgetApiError({ reason: 'response JSON is invalid', cause }),
      )
      if (raw instanceof Error) return raw

      const envelope = WidgetApiEnvelopeSchema.safeParse(raw)
      if (!envelope.success) {
        return new WidgetApiError({ reason: 'response envelope is invalid', cause: envelope.error })
      }

      if ('error' in envelope.data) {
        return new WidgetApiError({
          reason: `${envelope.data.error.code}: ${envelope.data.error.message}`,
        })
      }
      if (!response.ok) return new WidgetApiError({ reason: `HTTP ${response.status}` })

      return envelope.data.data as Events[Event]['result']
    },
  }
}
