import type { AtomLike, AtomState } from '@reatom/core'
import { useAtom } from '@reatom/react'

/**
 * Read an atom/computed the race-free way: via reatom-react's `useAtom`, which
 * is built on React's `useSyncExternalStore`.
 *
 * `reatomMemo` (`reatomComponent`) tracks reads during render and commits the
 * subscription in a post-render effect; an atom update that lands between the
 * first render and that commit is dropped. That is invisible against a real
 * network (responses arrive long after commit) but bites server-backed widgets
 * read against the in-memory e2e backend, which answers in the same microtask —
 * the first paint then shows stale state that never updates. `useSyncExternalStore`
 * re-checks the snapshot when it subscribes, so it cannot miss that update. Use
 * this for the slices whose first paint depends on async-on-mount server reads.
 */
export function useAtomValue<T extends AtomLike>(atom: T): AtomState<T> {
  return useAtom(atom)[0]
}
