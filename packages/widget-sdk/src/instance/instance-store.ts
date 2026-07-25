import { computed, withDisconnectHook } from '@reatom/core'
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
 * Reatom's connection lifetime is the reference count: the value is built for
 * the first subscriber and disposed when the last one disconnects. Reading the
 * atom inside a `reatomMemo` component is what subscribes that mount, so there
 * is nothing to release by hand.
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
    const handle = computed(() => {
      current = { value: make() }
      return current.value
    }, `${name}#${key}`).extend(
      withDisconnectHook(() => {
        // A computed's cache survives disconnection, so the handle has to go
        // with the value: keeping it would hand the next mount a disposed
        // value instead of rebuilding one.
        handles.delete(key)
        const held = current
        current = null
        if (held) dispose?.(held.value, key)
      }),
    )
    handles.set(key, handle)
    return handle
  }
}
