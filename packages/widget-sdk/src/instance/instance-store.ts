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
 * there is nothing to release by hand. Reading it OUTSIDE a subscribed
 * context (e.g. a bare `store(instanceId, make)()` call from an action, with
 * no component ever mounting) still builds a value, but since no subscriber
 * ever connects, `dispose` never runs for it — keep this store's reads
 * confined to `reatomMemo` components.
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
    const handle: Computed<Value> = computed(() => {
      current ??= { value: make() }
      return current.value
    }, `${name}#${key}`).extend(
      withConnectHook(() => {
        // The compute function above already builds eagerly on first read, but
        // connect is still the value's canonical lifecycle owner: it rebuilds
        // here too so a reconnect after a real disposal gets a fresh value
        // instead of resurrecting a disposed one, and it re-registers the
        // handle in case a stale disconnect (see below) had evicted it.
        current ??= { value: make() }
        handles.set(key, handle)

        return () => {
          // Reatom defers disconnect cleanup to a microtask, so an unsubscribe
          // immediately followed by a resubscribe of the same key (React
          // StrictMode's double-invoked effects, a same-commit re-key, a
          // suspense retry) can still have this cleanup queued when a new
          // subscriber is already connected. Disposing then would kill a
          // value a live mount is still rendering, so only tear down once
          // nothing is connected.
          if (isConnected(handle)) return
          // Only remove the map entry if it still points at THIS handle —
          // a stale disconnect must never evict a newer, currently-connected
          // handle for the same key.
          if (handles.get(key) === handle) handles.delete(key)
          const held = current
          current = null
          if (held) dispose?.(held.value, key)
        }
      }),
    )
    handles.set(key, handle)
    return handle
  }
}
