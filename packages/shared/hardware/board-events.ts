import * as errore from 'errore'

import { HARDWARE_EVENTS_KEY, type HardwareBoardEvent, HardwareBoardEventSchema } from './board-api'

/** The board's hardware SSE stream (a storage-style `{ key, value }` frame per event). */
export const HARDWARE_EVENTS_URL = '/api/hardware/events'

/** One SSE `data` payload as a hardware event; `null` for another key, a bad value or bad JSON. */
export function parseHardwareFrame(data: string): HardwareBoardEvent | null {
  const frame = errore.try(() => JSON.parse(data) as unknown)
  if (frame instanceof Error || typeof frame !== 'object' || frame === null) return null
  const { key, value } = frame as { key?: unknown; value?: unknown }
  if (key !== HARDWARE_EVENTS_KEY) return null
  const event = HardwareBoardEventSchema.safeParse(value)
  return event.success ? event.data : null
}
