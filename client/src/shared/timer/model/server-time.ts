import {
  action,
  atom,
  computed,
  withAsync,
  withConnectHook,
  wrap,
  type Action,
  type Computed,
} from '@reatom/core'
import { fetchServerTime, type TimeError } from './http-time'

export interface ServerTime {
  /** Current server moment (clientNow + offset), or null before the first sync. */
  nowMs(): number | null
  /** Server "today" in the given zone, or null before the first sync. */
  today(timeZone: string): Temporal.PlainDate | null
  /** Status-tracked action: computes the offset via fetchServerTime(). */
  readonly sync: Action<[], Promise<void>>
  /** True after the first successful sync (offset known). */
  readonly isSynced: Computed<boolean>
}

export function createServerTime(
  fetchTime: () => Promise<number | TimeError> = fetchServerTime,
): ServerTime {
  const offsetMs = atom<number | null>(null, 'serverTime.offsetMs')

  const nowMs = (): number | null => {
    const offset = offsetMs()
    return offset == null ? null : Date.now() + offset
  }

  const today = (timeZone: string): Temporal.PlainDate | null => {
    const now = nowMs()
    if (now == null) return null
    return Temporal.Instant.fromEpochMilliseconds(now)
      .toZonedDateTimeISO(timeZone)
      .toPlainDate()
  }

  const sync = action(async () => {
    const result = await wrap(fetchTime())
    if (result instanceof Error) throw result
    offsetMs.set(result - Date.now())
  }, 'serverTime.sync').extend(withAsync({ status: true }))

  const isSynced = computed(() => offsetMs() != null, 'serverTime.isSynced')

  // Re-sync on consumer connect/reconnect and on tab refocus. No polling.
  offsetMs.extend(
    withConnectHook(() => {
      sync()
      const onVisible = wrap(() => {
        if (document.visibilityState === 'visible') sync()
      })
      document.addEventListener('visibilitychange', onVisible)
      return () => document.removeEventListener('visibilitychange', onVisible)
    }),
  )

  return { nowMs, today, sync, isSynced }
}

let instance: ServerTime | null = null

/** Lazy app-wide ServerTime (one offset shared across all consumers). */
export function getServerTime(): ServerTime {
  if (instance == null) instance = createServerTime()
  return instance
}
