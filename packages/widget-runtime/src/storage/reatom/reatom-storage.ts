import {
  abortVar,
  action,
  atom,
  AtomState,
  Computed,
  effect,
  Ext,
  withAsync,
  withChangeHook,
  withConnectHook,
  wrap,
  isAtom,
} from '@reatom/core'
import { Atom } from '@reatom/core'
import type { z } from 'zod'

import { clearExpired } from '../client/db'
import type { StorageApi, StorageError, StorageListener, StorageOptions } from '../types'

/**
 * Status-tracked mutations over a StorageApi. The underlying api returns errors
 * as values; we re-throw them so withAsync captures them in `.error()`/`.status()`.
 */
export function reatomStorageMutations(api: StorageApi, name: string) {
  const set = action(async (key: string, value: unknown, options?: StorageOptions) => {
    const result = await wrap(api.set(key, value, options))
    if (result instanceof Error) throw result
  }, `${name}.set`).extend(withAsync({ status: true }))

  const remove = action(async (key: string) => {
    const result = await wrap(api.delete(key))
    if (result instanceof Error) throw result
  }, `${name}.remove`).extend(withAsync({ status: true }))

  return { set, remove }
}

/** Action that purges expired client (Dexie) rows. */
export function reatomClearExpired(name: string) {
  return action(async () => {
    await wrap(clearExpired())
  }, `${name}.clearExpired`).extend(withAsync())
}

export type WithStorageKeyOptions<T> = {
  api: StorageApi
  key: string
  schema?: z.ZodType<T>
}

export type StorageKeyExt<State> = {
  asyncValue: Atom<State | null>
  error: Atom<StorageError | null>
  updatePromise: Atom<Promise<StorageError | void> | null>
  isLoading: Atom<boolean>
}

/** Reactive value of a single key over StorageApi.subscribe. */
export const withStorageKey =
  <Target extends Atom>({
    api,
    key,
    schema,
  }: WithStorageKeyOptions<AtomState<Target>>): Ext<Target, StorageKeyExt<AtomState<Target>>> =>
  (target) => {
    const asyncValue = atom<AtomState<Target> | null>(null, `${target.name}.value`)
    const error = atom<StorageError | null>(null, `${target.name}.error`)
    const updatePromise = atom<Promise<StorageError | void> | null>(
      null,
      `${target.name}.updatePromise`,
    )
    const isLoading = atom(true, `${target.name}.isLoading`)

    target.extend(
      withConnectHook(() => {
        const defaultValue = target()

        return api.subscribe<AtomState<Target>>(
          key,
          wrap((event) => {
            isLoading.set(false)
            if (event instanceof Error) return error.set(event)
            error.set(null)
            // Apply the same object reference to both atoms so the change hook
            // can identity-match it as a server echo (see the guard below).
            asyncValue.set(event.value)
            target.set(event.value ?? defaultValue)
          }),
          schema,
        )
      }),
      withChangeHook((state) => {
        // Echo guard: the connect hook applies server-delivered values via
        // `target.set`, which re-enters this change hook (the change hook fires
        // asynchronously, so a flag set around `target.set` would already be
        // cleared by now). Writing that value back would republish it over SSE
        // and re-deliver it here, looping forever. The connect hook reuses the
        // exact object it stored in `asyncValue`, so an identity match means
        // this change is that echo — skip it. Genuine local mutations always
        // produce a fresh object, so they are never skipped.
        if (Object.is(state, asyncValue())) return
        // A failed write keeps the optimistic local state and only records the
        // error. Reverting to the previous value resonates with effects that
        // re-fill defaults (e.g. selectInitialActiveBoard): revert → effect
        // writes again → write fails → revert… an unbounded write cycle that
        // livelocks the tab whenever the backend is persistently down.
        // The continuations are wrap()ed: they run after an await boundary and
        // would otherwise lose the reactive frame (silently dropping the sets
        // under context.start, i.e. in SSR/tests).
        const promise = api
          .set(key, state)
          .then(
            wrap((err) => {
              if (err instanceof Error) error.set(err)
            }),
          )
          .finally(wrap(() => updatePromise.set(null)))
        updatePromise.set(promise)
      }),
    )

    return {
      isLoading,
      asyncValue,
      error,
      updatePromise,
    }
  }

export type WithStorageKeyReadonlyOptions<T> = {
  api: StorageApi
  key: string | Computed<string | null>
  schema?: z.ZodType<T>
  /** Applied when the key is absent/deleted (StorageChange.value === null). */
  fallback: T
}

export type StorageKeyReadonlyExt = {
  error: Atom<StorageError | null>
  isLoading: Atom<boolean>
}

/**
 * Read-only reactive mirror of a single key over StorageApi.subscribe. Unlike
 * withStorageKey there is NO write-back: the atom never PUTs itself. Use for
 * append-only / server-owned values written via api.append (server-stamped
 * id/ts/ip), never api.set.
 */
export const withStorageKeyReadonly =
  <Target extends Atom>({
    api,
    key,
    schema,
    fallback,
  }: WithStorageKeyReadonlyOptions<AtomState<Target>>): Ext<Target, StorageKeyReadonlyExt> =>
  (target) => {
    const isLoading = atom(true, 'storage.isLoading')
    const error = atom<StorageError | null>(null, 'storage.error')

    target.extend(
      withConnectHook(() => {
        const listener: StorageListener<AtomState<Target>> = wrap((event) => {
          isLoading.set(false)
          if (event instanceof Error) return error.set(event)
          error.set(null)
          target.set(event.value ?? fallback)
        })

        // A Computed key (e.g. keyed by the viewed week) must move the api
        // subscription when it changes. Resolving it here directly would pin
        // the first value forever: connect hooks run as an action, without
        // dependency tracking, and fire only on the disconnected → connected
        // edge. The effect tracks the key and re-subscribes per value
        // (including null → key: subscribe late; key → null: just unsubscribe).
        // Each run's api subscription is tied to that run's abort context, so
        // it is dropped automatically both when the key changes (withAbort
        // cancels the previous run) and on disconnect (the connect hook's
        // abort tears the effect down) — no manual cleanup to return.
        effect(() => {
          const resolvedKey = isAtom(key) ? key() : key
          if (resolvedKey == null) return
          const unsubscribe = api.subscribe<AtomState<Target>>(resolvedKey, listener, schema)
          abortVar.subscribe(() => unsubscribe())
        }, `${target.name}.followKey`)
      }),
    )
    return { error, isLoading }
  }
