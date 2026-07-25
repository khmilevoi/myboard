import { computed, isConnected, withConnectHook } from '@reatom/core'
import type { Computed } from '@reatom/core'

export type WidgetInstanceStore<Value> = (key: string, make: () => Value) => Computed<Value>

export type MakeWidgetInstanceStoreOptions<Value> = {
  /** Atom name prefix; each instance is named `${name}#${key}`. */
  name: string
  dispose?: (value: Value, key: string) => void
}

/**
 * One value per widget instance, shared by every mount of that instance.
 *
 * The board renders a tile for every placed widget and the fullscreen overlay
 * renders a SECOND frame for the expanded one, so anything a widget keeps in
 * `useMemo` is built twice and lost on every tier switch. A widget creates one
 * store at module scope, keys it by `instanceId`, and every mount reads the
 * same atom.
 *
 * `make` runs lazily on first read (a component's initial render reads the
 * value before its effect subscribes, so it can't wait for a connection) and
 * is cached for every later read of the same key. Disposal is what the
 * connection lifetime actually governs: `dispose` runs once the last
 * subscriber disconnects, and the same connect/disconnect pair also rebuilds
 * the value if the atom is ever reconnected after a disposal. Reading the
 * atom inside a `reatomMemo` component is what subscribes that mount, so
 * there is nothing to release by hand.
 *
 * Reading it OUTSIDE a subscribed context (e.g. a bare `store(instanceId,
 * make)()` call from an action, with no component ever mounting) still
 * builds a value eagerly, same as above — but the store gives that build one
 * microtask to be claimed by a real subscriber. If nothing has subscribed by
 * then, the value is disposed and the handle is evicted, so an orphaned read
 * can't pin a `make()` result — or its `handles` entry — forever.
 *
 * This is a factory, not a shared registry: the map belongs to the store the
 * widget created, so widget-sdk stays stateless and one widget's instances are
 * invisible to another.
 *
 * `make` runs only for the first mount of a key. Pass one whose captured inputs
 * are interchangeable between mounts, and do NOT read atoms inside it — the
 * instance is a `computed`, so a reactive dependency would silently rebuild the
 * whole value when it changes.
 */
export function makeWidgetInstanceStore<Value>({
  name,
  dispose,
}: MakeWidgetInstanceStoreOptions<Value>): WidgetInstanceStore<Value> {
  const handles = new Map<string, Computed<Value>>()

  return (key, make) => {
    const cached = handles.get(key)
    if (cached) return cached

    let current: { value: Value } | null = null

    // Shared by both the eager "built on a bare read" path and the
    // connect-hook's real disposal path. Guarded by `current`, so whichever
    // one runs first performs the teardown and the other is a no-op — never
    // a double dispose.
    const teardownIfOrphaned = () => {
      if (isConnected(handle)) return
      // Only remove the map entry if it still points at THIS handle — a
      // stale teardown must never evict a newer, currently-connected handle
      // for the same key.
      if (handles.get(key) === handle) handles.delete(key)
      const held = current
      current = null
      if (held) dispose?.(held.value, key)
    }

    const handle: Computed<Value> = computed(() => {
      const isFirstBuild = current === null
      current ??= { value: make() }
      if (isFirstBuild) {
        // A plain read (no subscriber yet) can come from a real mount whose
        // effect subscribes synchronously right after this render commits,
        // or from a bare call with no component ever mounting. Both look
        // identical here, so give it one microtask — enough for a real
        // mount's connect to land, since only the deferred *callback* of
        // `withConnectHook` is queued that way, not the synchronous
        // subscribe() that flips `isConnected`. If nothing claimed it by
        // then, it was an orphaned read: dispose it instead of leaking the
        // built value and the map entry forever.
        queueMicrotask(teardownIfOrphaned)
      }
      return current.value
    }, `${name}#${key}`).extend(
      withConnectHook(() => {
        // The compute function above already builds eagerly on first read,
        // but connect is still the value's canonical lifecycle owner: it
        // rebuilds here too so a reconnect after a real disposal gets a
        // fresh value instead of resurrecting a disposed one.
        current ??= { value: make() }

        return () => {
          // Reatom defers disconnect cleanup to a microtask, so an unsubscribe
          // immediately followed by a resubscribe of the same key (React
          // StrictMode's double-invoked effects, a same-commit re-key, a
          // suspense retry) can still have this cleanup queued when a new
          // subscriber is already connected. Disposing then would kill a
          // value a live mount is still rendering, so only tear down once
          // nothing is connected.
          teardownIfOrphaned()
        }
      }),
    )
    handles.set(key, handle)
    return handle
  }
}
