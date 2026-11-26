import { action, atom, computed, wrap } from '@reatom/core'
import type { AtomLike, Computed } from '@reatom/core'
import { healthModule, type HealthRange } from 'module-health'
import type { Measurement } from 'module-health/domain/measurement'
import type {
  ModuleAccessError,
  ModuleLoadError,
  StorageError,
  WidgetModules,
} from 'widget-runtime'
import { reatomModule } from 'widget-sdk/modules/reatom-module'

import { makeClock } from './clock'

export type WeightPeriod = '30d' | '90d' | '1y'

export const WEIGHT_PERIODS: readonly WeightPeriod[] = ['30d', '90d', '1y']

export type WeightPoint = { takenAt: number; kg: number }

export type WeightRow = { id: string; takenAt: number; kg: number; change: number | null }

export type WeightState = 'loading' | 'error' | 'empty' | 'no-period-data' | 'single' | 'ready'

export type WeightLoadError = ModuleAccessError | ModuleLoadError | StorageError

/** Everything that depends on the period, for one period source. */
export type WeightLens = {
  /**
   * The period of the readings these members show. Right after a period switch it is still the
   * previous period, until the new one's months have loaded.
   */
  period: Computed<WeightPeriod>
  /** True while a newly chosen range loads and the previous readings stay on screen. */
  updating: Computed<boolean>
  /** The shown weight readings, oldest first; null until a period has loaded the first time. */
  points: Computed<WeightPoint[] | null>
  /** Last minus first point; null with fewer than two points. */
  delta: Computed<number | null>
  /** Min and max of `points`; null when there are none. */
  bounds: Computed<{ min: number; max: number } | null>
  /** `points` newest first; `change` is against the next older row, null on the oldest. */
  rows: Computed<WeightRow[] | null>
  state: Computed<WeightState>
  /** Why the card cannot show anything; null while it can (or is still loading). */
  error: Computed<WeightLoadError | null>
}

/** One render's worth of a lens, read by the card and handed to a tier. */
export type WeightCardData = {
  state: Exclude<WeightState, 'loading' | 'error' | 'empty'>
  latest: Measurement
  /** The period the trend covers; always `30d` on the compact lens. */
  period: WeightPeriod
  /** The period the control shows as chosen. */
  selectedPeriod: WeightPeriod
  points: WeightPoint[]
  delta: number | null
  bounds: { min: number; max: number } | null
  rows: WeightRow[]
  now: number
}

type Reading = { id: string; takenAt: number; kg: number }

type Snapshot = { period: WeightPeriod; readings: Reading[] }

const DAY_MS = 86_400_000
const PERIOD_DAYS: Record<WeightPeriod, number> = { '30d': 30, '90d': 90, '1y': 365 }

/**
 * The weight card's view over the health module: the latest weight (always the newest reading,
 * even when it is older than the period) and the trend inside the selected period. The period
 * lives only as long as the view — it is deliberately not persisted.
 *
 * `compact` is the same view pinned to 30 days: the compact tier has no period control, and
 * reading the pinned lens keeps the selected period intact for when the card grows back.
 */
export function makeWeightView(modules: WidgetModules, now: () => number) {
  const handle = reatomModule({ modules, module: healthModule, name: 'weight.module' })

  // Ticks at local midnight and hourly while the card is mounted: the period window and
  // "сегодня" are read from it, never from a one-off call to `now`.
  const clock = makeClock(now, 'weight.clock')

  const latestAtom = computed(() => handle.model()?.latest('weight') ?? null, 'weight.latestAtom')

  const latest = computed<Measurement | null>(() => latestAtom()?.() ?? null, 'weight.latest')

  const period = atom<WeightPeriod>('30d', 'weight.period')

  // The spec mandates a named setter in the view's interface.
  const setPeriod = action((next: WeightPeriod) => {
    period.set(next)
  }, 'weight.setPeriod')

  // The latest atom is read only once it has loaded (see `range`), so a storage failure there must
  // be judged here: never loaded, not loading, and the read failed. A later transient error over a
  // loaded value is not a failure of the card.
  const latestFailed = computed<StorageError | null>(() => {
    const target = latestAtom()
    if (!target) return null
    if (target() !== null || target.isLoading()) return null
    return target.error()
  }, 'weight.latestFailed')

  const makeLens = (source: AtomLike<WeightPeriod>, name: string): WeightLens => {
    // Follows the period, the clock and the newest reading. `to` never falls before the latest
    // reading, so a scale clock slightly ahead of this one cannot clip the newest point — but it
    // stretches at most a day past now, so a far-future reading cannot widen the range by years.
    const range = computed<HealthRange>(() => {
      const days = PERIOD_DAYS[source()]
      const newest = latest()?.takenAt ?? 0
      const at = clock()
      return { from: at - days * DAY_MS, to: Math.min(Math.max(at, newest), at + DAY_MS) }
    }, `${name}.range`)

    // The module model is set once and kept, so each of these is built once.
    const series = computed(
      () => handle.model()?.series('weight', range) ?? null,
      `${name}.seriesSource`,
    )
    const rangeError = computed(
      () => handle.model()?.rangeError(range) ?? null,
      `${name}.rangeErrorSource`,
    )

    // The current range's readings; null while any of its months is still loading.
    // `series('weight')` only returns readings carrying a weight; the guard keeps the types honest.
    const current = computed<Snapshot | null>(() => {
      const shownFor = source()
      const list = series()?.()
      if (!list) return null
      const readings = list.flatMap((m) =>
        m.metrics.weight ? [{ id: m.id, takenAt: m.takenAt, kg: m.metrics.weight.value }] : [],
      )
      return { period: shownFor, readings }
    }, `${name}.current`)

    // `loading` is the first load only. After it, a new range (another period, or a new month
    // reached on a clock tick) keeps the last loaded readings on screen until its own months
    // arrive, so the card — and the period control just pressed — stays mounted.
    const shown = computed<Snapshot | null>(
      (previous?: Snapshot | null) => current() ?? previous ?? null,
      `${name}.shown`,
    )

    const readings = computed(() => shown()?.readings ?? null, `${name}.readings`)

    const shownPeriod = computed(() => shown()?.period ?? source(), `${name}.shownPeriod`)

    const updating = computed(() => shown() !== null && current() === null, `${name}.updating`)

    const points = computed<WeightPoint[] | null>(
      () => readings()?.map(({ takenAt, kg }) => ({ takenAt, kg })) ?? null,
      `${name}.points`,
    )

    const delta = computed<number | null>(() => {
      const list = points()
      if (!list || list.length < 2) return null
      return list[list.length - 1].kg - list[0].kg
    }, `${name}.delta`)

    const bounds = computed(() => {
      const list = points()
      if (!list || list.length === 0) return null
      const kgs = list.map((p) => p.kg)
      return { min: Math.min(...kgs), max: Math.max(...kgs) }
    }, `${name}.bounds`)

    const rows = computed<WeightRow[] | null>(() => {
      const list = readings()
      if (!list) return null
      return list
        .map((row, index) => ({
          ...row,
          change: index === 0 ? null : row.kg - list[index - 1].kg,
        }))
        .reverse()
    }, `${name}.rows`)

    const error = computed<WeightLoadError | null>(() => {
      const moduleError = handle.error()
      if (moduleError) return moduleError
      // `rangeError` does not connect the month atoms; reading `current` (the series) here does.
      // A failed month of the current range is a failure even over older shown readings:
      // otherwise the chosen period would never load and nothing would say so.
      const loaded = current()
      const monthError = rangeError()?.() ?? null
      if (loaded === null && monthError) return monthError
      return latestFailed()
    }, `${name}.error`)

    const state = computed<WeightState>(() => {
      if (error()) return 'error'
      const target = latestAtom()
      if (!target) return 'loading'
      const newest = target()
      const list = points()
      // Both must have loaded before "empty" and "no data in the period" can be told apart.
      if (target.isLoading() || list === null) return 'loading'
      if (newest === null) return 'empty'
      if (list.length === 0) return 'no-period-data'
      if (list.length === 1) return 'single'
      return 'ready'
    }, `${name}.state`)

    return { period: shownPeriod, updating, points, delta, bounds, rows, state, error }
  }

  const selected = makeLens(period, 'weight')
  const compact = makeLens(
    computed((): WeightPeriod => '30d', 'weight.compact.period'),
    'weight.compact',
  )

  // A failed module chunk is retried by loading it again; otherwise the model re-reads every key
  // whose first read failed.
  const retry = action(async () => {
    if (handle.error()) {
      await wrap(handle.retry())
      return
    }
    const model = handle.model()
    if (!model) return
    await wrap(model.retry())
  }, 'weight.retry')

  return {
    ...selected,
    /** The chosen period: the control's state. `shownPeriod` is what the shown readings cover. */
    period,
    shownPeriod: selected.period,
    setPeriod,
    latest,
    retry,
    /** The ticking clock; read it instead of calling the injected `now`. */
    now: clock,
    /** The selected period's lens, as one record (the members above are spread from it). */
    selected,
    compact,
  }
}

export type WeightView = ReturnType<typeof makeWeightView>
