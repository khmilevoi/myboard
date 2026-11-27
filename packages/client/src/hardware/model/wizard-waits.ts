import { type AtomLike, isAbort, sleep, take, wrap } from '@reatom/core'

/** Fire-and-forget launcher for the wizard's abortable waits: an abort is expected, anything else is logged. */
export function launch(promise: Promise<unknown>, what: string) {
  promise.catch((cause: unknown) => {
    if (isAbort(cause)) return
    console.warn(`Hardware wizard ${what} failed:`, cause)
  })
}

export type WaitFor = <T>(target: AtomLike<T | null>, timeoutMs: number) => Promise<T | null>

/**
 * Resolves with the first non-null value of `target`, or null once `timeoutMs` passed on `now`
 * (the server-aligned clock). Must run inside an action frame: it wraps its own awaits.
 */
export function makeWaitFor(now: () => number): WaitFor {
  return async function waitFor<T>(target: AtomLike<T | null>, timeoutMs: number) {
    const deadline = now() + timeoutMs
    while (true) {
      const value = target()
      if (value !== null) return value
      const remaining = deadline - now()
      if (remaining <= 0) return null
      await wrap(Promise.race([wrap(take(target)), wrap(sleep(remaining))]))
    }
  }
}
