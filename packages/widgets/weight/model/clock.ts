import { atom, sleep, withConnectHook, wrap } from '@reatom/core'
import type { Atom } from '@reatom/core'

const HOUR_MS = 3_600_000

/** Time to the next tick: the next local midnight, or an hour, whichever comes first. */
export function msUntilNextTick(at: number): number {
  const midnight = new Date(at)
  midnight.setHours(24, 0, 0, 0)
  return Math.max(1, Math.min(midnight.getTime() - at, HOUR_MS))
}

/**
 * The card's notion of "now" as an atom, so that everything derived from it — the period window,
 * "сегодня" — moves on while the card stays open. It ticks at every local midnight and at least
 * hourly, only while something is connected to it; `now` is the time source, injected so tests
 * stay deterministic.
 *
 * The hook is a plain function that re-enters itself through `wrap(sleep(...)).then(...)`, the same
 * shape as `widget-runtime`'s identity refresh: when the last subscriber leaves, the connect scope
 * aborts the pending `sleep` and the rejection simply ends the loop.
 */
export function makeClock(now: () => number, name: string): Atom<number> {
  const clock = atom(now(), name)
  clock.extend(
    withConnectHook(() => {
      const step = () => {
        const at = now()
        clock.set(at)
        wrap(sleep(msUntilNextTick(at))).then(step, () => {})
      }
      step()
    }),
  )
  return clock
}
