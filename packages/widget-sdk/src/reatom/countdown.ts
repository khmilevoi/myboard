import {
  type Atom,
  atom,
  type AtomLike,
  type Computed,
  computed,
  withConnectHook,
  wrap,
} from '@reatom/core'

/** An atom of `now()` that re-reads every `intervalMs` while connected (connect-hook owned). */
export function makeTickingNow(options: {
  now: () => number
  intervalMs: number
  name: string
}): Atom<number> {
  const { now, intervalMs, name } = options
  const ticking = atom(() => now(), name).extend(
    withConnectHook(() => {
      const intervalId = setInterval(
        wrap(() => ticking.set(now())),
        intervalMs,
      )
      return () => clearInterval(intervalId)
    }),
  )
  return ticking
}

/** `4:52`; clamps at `0:00`; rounds seconds up. */
export function formatCountdown(msRemaining: number): string {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function makeCountdown(options: {
  expiresAt: AtomLike<number | null>
  clock: Atom<number>
  name: string
}): { remainingMs: Computed<number>; label: Computed<string>; expired: Computed<boolean> } {
  const { expiresAt, clock, name } = options
  const remainingMs = computed(() => {
    const expires = expiresAt()
    if (expires == null) return 0
    return Math.max(0, expires - clock())
  }, `${name}.remainingMs`)
  const label = computed(() => formatCountdown(remainingMs()), `${name}.label`)
  const expired = computed(() => {
    const expires = expiresAt()
    return expires != null && clock() >= expires
  }, `${name}.expired`)
  return { remainingMs, label, expired }
}
