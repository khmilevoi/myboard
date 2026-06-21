import { action, atom, withAsync } from '@reatom/core'
import type { ServerTime } from './server-time'

/** In-memory ServerTime double for model tests: controllable today()/nowMs(). */
export function createFakeTimer(options?: {
  today?: Temporal.PlainDate | null
  nowMs?: number
}): ServerTime {
  const todayValue = options?.today ?? null
  const nowValue = options?.nowMs ?? null
  const synced = todayValue != null || nowValue != null

  return {
    nowMs: () => nowValue,
    today: () => todayValue,
    sync: action(async () => {}, 'fakeTimer.sync').extend(withAsync({ status: true })),
    isSynced: atom(synced, 'fakeTimer.isSynced'),
  }
}
