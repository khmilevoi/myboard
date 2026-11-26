import { atom, computed, wrap } from '@reatom/core'
import type { Atom, AtomLike, Computed } from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError } from 'widget-runtime'
import type { ModuleContext } from 'widget-runtime/define-module'

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
  latest(kind: MetricKind): Atom<Measurement | null>
  /**
   * Readings carrying `kind` inside `[from, to]` (inclusive), deduped by id and sorted by takenAt.
   * null until every month ledger in range has loaded; a month with no ledger is loaded-and-empty.
   */
  series(kind: MetricKind, range: AtomLike<HealthRange>): Computed<Measurement[] | null>
  setProfile(profile: Profile): Promise<ModuleApiError | void>
}

export function makeHealthModel(context: HealthModuleContext): HealthModel {
  const { api } = context
  const server = context.storage.account.server

  const profile = atom<Profile | null>(null, 'health.profile').extend(
    withStorageKeyReadonly({
      api: server,
      key: PROFILE_KEY,
      schema: ProfileSchema,
      fallback: null,
    }),
  )

  // One atom per key for the model's lifetime: every consumer shares one subscription, opened by
  // the atom's connect hook when the first subscriber arrives. A missing key resolves to the
  // fallback; the atom itself starts at null, the "not loaded yet" sentinel.
  const latestAtoms = new Map<MetricKind, Atom<Measurement | null>>()
  const latest = (kind: MetricKind): Atom<Measurement | null> => {
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
    latestAtoms.set(kind, created)
    return created
  }

  // null = not loaded yet; a key with no stored ledger resolves to [] (loaded and empty).
  const monthAtoms = new Map<string, Atom<Measurement[] | null>>()
  const month = (key: string): Atom<Measurement[] | null> => {
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

  // Failures are returned as values; nothing after the await touches an atom.
  const setProfile = async (value: Profile): Promise<ModuleApiError | void> => {
    const result = await wrap(api.invoke('setProfile', value))
    if (result instanceof Error) return result
  }

  return { profile, latest, series, setProfile }
}
