import { HttpClient, type HttpLike } from '@shared/http/client'
import * as errore from 'errore'
import { z } from 'zod'

export class TimeError extends errore.createTaggedError({
  name: 'TimeError',
  message: 'Server time fetch failed: $reason',
}) {}

export const ServerTimeSchema = z.object({ now: z.number() })
export type ServerTimeResponse = z.infer<typeof ServerTimeSchema>

/**
 * Fetches server epoch ms. Network/parse failures are returned as TimeError,
 * never thrown. The default client is bare (no auth hook) — deliberate:
 * server-time is a pre-existing module-level model outside the HostRuntime;
 * a 401 here is a non-fatal TimeError and the session heals via any
 * storage-triggered relogin. Built per call: construction just stores an
 * options object, and stateless beats a module-level cache.
 */
export async function fetchServerTime(
  baseUrl = '/api/time',
  http: HttpLike = new HttpClient(),
): Promise<number | TimeError> {
  const res = await http.get(baseUrl)
  if (res instanceof Error) return new TimeError({ reason: 'fetch failed', cause: res })
  if (!res.ok) return new TimeError({ reason: `status ${res.status}` })
  const parsed = ServerTimeSchema.safeParse(res.body)
  if (!parsed.success) {
    return new TimeError({ reason: 'invalid response shape', cause: parsed.error })
  }
  return parsed.data.now
}
