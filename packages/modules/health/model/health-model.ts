import { action, atom, computed, wrap } from '@reatom/core'
import type { Action, Atom, AtomLike, Computed } from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError, StorageError, StorageKeyReadonlyExt } from 'widget-runtime'
import type { ModuleContext } from 'widget-runtime/define-module'
import type { z } from 'zod'

import type { healthActionSchemas } from '../domain/actions'
import { PROFILE_KEY, latestKey, monthKeysInRange } from '../domain/keys'
import { MeasurementLedgerSchema, MeasurementSchema, type Measurement } from '../domain/measurement'
import type { MetricKind } from '../domain/metrics'
import { ProfileSchema, type Profile } from '../domain/profile'
import { mergeSeries } from '../domain/series'

export type HealthModuleContext = ModuleContext<typeof healthActionSchemas, 'account'>

export type HealthRange = { from: number; to: number }

export type HealthModel = {
  /** The account's profile; null until loaded or while none is stored. */
  profile: Atom<Profile | null>
  /** Newest reading carrying `kind`; null until loaded or while none exists. Memoized per kind. */
  latest(kind: MetricKind): Atom<Measurement | null> & StorageKeyReadonlyExt
  /**
   * Readings carrying `kind` inside `[from, to]` (inclusive), deduped by id and sorted by takenAt.
   * null until every month ledger in range has loaded; a month with no ledger is loaded-and-empty.
   */
  series(kind: MetricKind, range: AtomLike<HealthRange>): Computed<Measurement[] | null>
  /** First storage read error among the month ledgers in range; null when none failed. */
  rangeError(range: AtomLike<HealthRange>): Computed<StorageError | null>
  /** Re-fetches every key atom (profile, latest, months) whose initial read failed. */
  retry: Action<[], Promise<void>>
  setProfile(profile: Profile): Promise<ModuleApiError | void>
}

export function makeHealthModel(context: HealthModuleContext): HealthModel {
  const { api } = context
  const server = context.storage.account.server

  // Every key atom registers here so `retry` can re-run the one-shot fetch of the failed ones.
  const retryers: { failed: () => boolean; run: () => Promise<void> }[] = []
  const track = <T>(
    target: Atom<T> & StorageKeyReadonlyExt,
    key: string,
    schema: z.ZodType<T>,
    fallback: T,
  ) => {
    retryers.push({
      failed: () => target.error() !== null,
      run: async () => {
        target.isLoading.set(true)
        const result = await wrap(server.get(key, schema))
        target.isLoading.set(false)
        if (result instanceof Error) {
          target.error.set(result)
          return
        }
        target.error.set(null)
        target.set(result ?? fallback)
      },
    })
    return target
  }

  const profile = atom<Profile | null>(null, 'health.profile').extend(
    withStorageKeyReadonly({
      api: server,
      key: PROFILE_KEY,
      schema: ProfileSchema,
      fallback: null,
    }),
  )
  track(profile, PROFILE_KEY, ProfileSchema, null)

  // One atom per key for the model's lifetime: every consumer shares one subscription, opened by
  // the atom's connect hook when the first subscriber arrives. A missing key resolves to the
  // fallback; the atom itself starts at null, the "not loaded yet" sentinel.
  const latestAtoms = new Map<MetricKind, Atom<Measurement | null> & StorageKeyReadonlyExt>()
  const latest = (kind: MetricKind) => {
    const cached = latestAtoms.get(kind)
    if (cached) return cached
    const created = atom<Measurement | null>(null, `health.latest.${kind}`).extend(
      withStorageKeyReadonly({
        api: server,
        key: latestKey(kind),
        schema: MeasurementSchema,
        fallback: null,
      }),
    )
    track(created, latestKey(kind), MeasurementSchema, null)
    latestAtoms.set(kind, created)
    return created
  }

  // null = not loaded yet; a key with no stored ledger resolves to [] (loaded and empty).
  const monthAtoms = new Map<string, Atom<Measurement[] | null> & StorageKeyReadonlyExt>()
  const month = (key: string) => {
    const cached = monthAtoms.get(key)
    if (cached) return cached
    const created = atom<Measurement[] | null>(null, `health.${key}`).extend(
      withStorageKeyReadonly({
        api: server,
        key,
        schema: MeasurementLedgerSchema,
        fallback: [],
      }),
    )
    track(created, key, MeasurementLedgerSchema, [])
    monthAtoms.set(key, created)
    return created
  }

  const series = (kind: MetricKind, range: AtomLike<HealthRange>) =>
    computed<Measurement[] | null>(() => {
      const { from, to } = range()
      // Read every month before deciding, so all of them connect and load in parallel.
      const ledgers = monthKeysInRange(from, to).map((key) => month(key)())
      if (ledgers.some((ledger) => ledger === null)) return null
      return mergeSeries(ledgers as Measurement[][], kind).filter(
        (m) => m.takenAt >= from && m.takenAt <= to,
      )
    }, `health.series.${kind}`)

  const rangeError = (range: AtomLike<HealthRange>) =>
    computed<StorageError | null>(() => {
      const { from, to } = range()
      let first: StorageError | null = null
      for (const key of monthKeysInRange(from, to)) {
        const error = month(key).error()
        if (first === null) first = error
      }
      return first
    }, 'health.rangeError')

  // Same one-shot read the extension performs at connect time, using the public `get`; the
  // extension has no retry of its own, so a failed first read would pin the atom at null forever.
  const retry = action(async () => {
    for (const entry of retryers.filter((candidate) => candidate.failed())) {
      await wrap(entry.run())
    }
  }, 'health.retry')

  // Failures are returned as values; nothing after the await touches an atom.
  const setProfile = async (value: Profile): Promise<ModuleApiError | void> => {
    const result = await wrap(api.invoke('setProfile', value))
    if (result instanceof Error) return result
  }

  return { profile, latest, series, rangeError, retry, setProfile }
}
