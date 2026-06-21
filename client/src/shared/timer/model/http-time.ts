import * as errore from 'errore'
import { z } from 'zod'

export class TimeError extends errore.createTaggedError({
  name: 'TimeError',
  message: 'Server time fetch failed: $reason',
}) {}

export const ServerTimeSchema = z.object({ now: z.number() })
export type ServerTimeResponse = z.infer<typeof ServerTimeSchema>

/** Fetches server epoch ms. Network/parse failures are returned as TimeError, never thrown. */
export async function fetchServerTime(baseUrl = '/api/time'): Promise<number | TimeError> {
  const res = await fetch(baseUrl).catch(
    (cause) => new TimeError({ reason: 'fetch failed', cause }),
  )
  if (res instanceof Error) return res
  if (!res.ok) return new TimeError({ reason: `status ${res.status}` })

  const body = await (res.json() as Promise<unknown>).catch(
    (cause) => new TimeError({ reason: 'json parse failed', cause }),
  )
  if (body instanceof Error) return body

  const parsed = ServerTimeSchema.safeParse(body)
  if (!parsed.success) return new TimeError({ reason: 'invalid response shape', cause: parsed.error })

  return parsed.data.now
}
