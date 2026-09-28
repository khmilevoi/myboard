import { action, atom, computed, withAsync, withConnectHook, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'
import {
  WidgetApiError,
  withStorageKey,
  withStorageKeyReadonly,
  type ServerTime,
  type WidgetStorage,
  type WidgetIdentity,
} from 'widget-runtime'
import { z } from 'zod'

import type { CatCareEvents } from '../domain/events'
import { foldLedger, LEDGER_KEY, MAX_FUTURE_SKEW_MS, validateCommand } from '../domain/ledger'
import { estimateCalorieTarget } from '../domain/nutrition'
import {
  LedgerEntriesSchema,
  type CatCareCommand,
  type CatProfile,
  type FoodRecord,
  type LedgerEntry,
  type Product,
  type WaterRecord,
  type WeightRecord,
} from '../domain/schemas'
import { getWeightSeries, summarizeDay, summarizePeriod } from '../domain/statistics'
import { getLocalDate } from '../domain/time'
import { computeWaterIntervals } from '../domain/water'
import { projectRecordAuthors } from './record-authors'

export type EntryPreference = { grams: number; mode: 'eaten' | 'offered' }
export type CatCareTab = 'today' | 'history' | 'products' | 'profile'
export type CreateCatCareModelOptions = {
  storage: WidgetStorage
  api: WidgetApi<CatCareEvents>
  timer: ServerTime
  identity: WidgetIdentity
}

const PreferencesSchema = z.record(
  z.string(),
  z.object({
    grams: z.number().finite().positive(),
    mode: z.enum(['eaten', 'offered']),
  }),
)

function publicError(error: Error | null | undefined): string | null {
  if (!error) return null
  if (error instanceof PublicWidgetError) return error.publicMessage
  if (error instanceof WidgetApiError) {
    if (error.code === 'network') return 'Нет соединения с сервером. Данные не подтверждены.'
    // These messages come from our validated domain error, never a raw
    // internal server/storage error. Other error details stay out of the UI.
    if (error.code.startsWith('cat_care_')) {
      const prefix = `${error.code}: `
      if (typeof error.reason === 'string' && error.reason.startsWith(prefix))
        return error.reason.slice(prefix.length)
    }
  }
  return 'Не удалось сохранить данные. Попробуйте ещё раз.'
}

export function createCatCareModel({ storage, api, timer, identity }: CreateCatCareModelOptions) {
  const ledger = atom<LedgerEntry[] | null>(null, 'catCare.ledger').extend(
    withStorageKeyReadonly({
      api: storage.instance.server,
      key: LEDGER_KEY,
      schema: LedgerEntriesSchema,
      fallback: [],
    }),
  )
  const state = computed(() => foldLedger(ledger() ?? []), 'catCare.state')
  const recordAuthors = computed(
    () => projectRecordAuthors({ entries: ledger() ?? [], members: identity.members() }),
    'catCare.recordAuthors',
  )
  const profile = computed(() => state().profile, 'catCare.profile')
  const allProducts = computed(() => state().products, 'catCare.allProducts')
  const products = computed(
    () => allProducts().filter((product) => !product.archived),
    'catCare.products',
  )
  const foods = computed(() => state().foods, 'catCare.foods')
  const water = computed(() => state().water, 'catCare.water')
  const weights = computed(() => state().weights, 'catCare.weights')
  const selectedDate = atom<string | null>(null, 'catCare.selectedDate')
  const periodDays = atom<7 | 30>(7, 'catCare.periodDays')
  const activeTab = atom<CatCareTab>('today', 'catCare.activeTab')
  const lastPortions = atom<Record<string, EntryPreference>>({}, 'catCare.lastPortions').extend(
    withStorageKey({
      api: storage.instance.client,
      key: 'entry-preferences',
      schema: PreferencesSchema,
    }),
  )

  // ServerTime synchronizes on visibility changes but does not tick. The
  // connection owns this single modest clock so a mounted diary crosses
  // midnight; an explicitly selected history date is never reset by it.
  const clockTick = atom(0, 'catCare.clockTick').extend(
    withConnectHook(() => {
      const tick = setInterval(
        wrap(() => clockTick.set((value) => value + 1)),
        30_000,
      )
      return () => clearInterval(tick)
    }),
  )
  // These resources belong to the mounted diary, not whichever form or date
  // happens to be visible. A historical date otherwise disconnects today's
  // clock, and a closed food editor would never load saved entry preferences.
  ledger.extend(
    withConnectHook(() => {
      const releasePreferences = lastPortions.subscribe(() => {})
      const releaseClock = clockTick.subscribe(() => {})
      return () => {
        releasePreferences()
        releaseClock()
      }
    }),
  )
  const nowMs = () => timer.nowMs() ?? Date.now()
  // Track the periodic tick while sampling time afresh whenever another
  // dependency changes. A cached timestamp would misclassify a newly saved
  // weight as future-dated until the next tick.
  const currentNow = () => {
    clockTick()
    return nowMs()
  }
  const today = computed(
    () => getLocalDate({ occurredAt: currentNow(), timeZone: profile().timeZone }),
    'catCare.today',
  )
  const activeDate = computed(() => selectedDate() ?? today(), 'catCare.activeDate')
  const daySummary = computed(
    () => summarizeDay({ state: state(), date: activeDate(), timeZone: profile().timeZone }),
    'catCare.daySummary',
  )
  const periodSummary = computed(
    () =>
      summarizePeriod({
        state: state(),
        endDate: activeDate(),
        days: periodDays(),
        timeZone: profile().timeZone,
      }),
    'catCare.periodSummary',
  )
  const waterIntervals = computed(() => computeWaterIntervals(water()), 'catCare.waterIntervals')
  const latestWeight = computed(
    () =>
      getWeightSeries({ records: weights(), toMs: currentNow() + MAX_FUTURE_SKEW_MS }).at(-1) ??
      null,
    'catCare.latestWeight',
  )
  const weightSeries = computed(() => {
    const end = Temporal.PlainDate.from(activeDate())
    const fromMs = end
      .subtract({ days: periodDays() - 1 })
      .toZonedDateTime(profile().timeZone).epochMilliseconds
    const toMs = end.add({ days: 1 }).toZonedDateTime(profile().timeZone).epochMilliseconds - 1
    return getWeightSeries({ records: weights(), fromMs, toMs })
  }, 'catCare.weightSeries')
  const energyEstimate = computed(
    () =>
      estimateCalorieTarget({
        profile: profile(),
        latestWeight: latestWeight(),
        nowMs: currentNow(),
      }),
    'catCare.energyEstimate',
  )

  const refreshSequence = { latest: 0 }
  const refresh = action(async () => {
    const request = ++refreshSequence.latest
    const before = ledger()
    const result = await wrap(storage.instance.server.get(LEDGER_KEY, LedgerEntriesSchema))
    // A stream event or a newer explicit read may already have delivered a
    // later journal. Never replace it with the snapshot this request captured.
    if (request !== refreshSequence.latest || ledger() !== before) return
    // withAsync is the adapter boundary where an Error value becomes the
    // extension's observable error state; public actions still return false.
    if (result instanceof Error) throw result
    ledger.set(result ?? [])
    ledger.error.set(null)
    ledger.isLoading.set(false)
  }, 'catCare.refresh').extend(withAsync())
  const retryLoad = action(async () => {
    const result = await wrap(
      refresh().then(
        () => true,
        (error: unknown) => {
          console.warn('[cat-care] Could not reload the journal', error)
          return false
        },
      ),
    )
    return result
  }, 'catCare.retryLoad')

  const retrySlot: { current: { fingerprint: string; mutationId: string } | null } = {
    current: null,
  }
  const performWrite = action(async (command: CatCareCommand) => {
    if (ledger() === null)
      throw new PublicWidgetError({
        code: 'cat_care_loading',
        publicMessage: 'Сначала дождитесь загрузки дневника.',
      })
    const invalid = validateCommand({ state: state(), command, nowMs: nowMs() })
    if (invalid instanceof Error) throw invalid
    const fingerprint = JSON.stringify(command)
    const attempt =
      retrySlot.current?.fingerprint === fingerprint
        ? retrySlot.current
        : { fingerprint, mutationId: crypto.randomUUID() }
    retrySlot.current = attempt
    const result = await wrap(api.invoke('write', { mutationId: attempt.mutationId, command }))
    if (result instanceof Error) throw result
    retrySlot.current = null
    // SSE normally arrives first. A read also makes the confirmed write
    // available before the next form is opened on a slow/reconnecting stream.
    // A failed read does not turn an acknowledged durable write into failure.
    await wrap(
      refresh().catch((error: unknown) => {
        console.warn('[cat-care] Saved, but could not refresh the journal', error)
      }),
    )
  }, 'catCare.performWrite').extend(withAsync())
  const runCommand = action(async (command: CatCareCommand): Promise<boolean> => {
    if (!performWrite.ready()) return false
    return await wrap(
      performWrite(command).then(
        () => true,
        (error: unknown) => {
          console.warn('[cat-care] Could not save the observation', error)
          return false
        },
      ),
    )
  }, 'catCare.runCommand')

  const saveProfile = action(
    (value: CatProfile) => runCommand({ kind: 'profile.save', profile: value }),
    'catCare.saveProfile',
  )
  const saveProduct = action(
    (value: Product) => runCommand({ kind: 'product.save', product: value }),
    'catCare.saveProduct',
  )
  const archiveProduct = action((id: string, archived = true) => {
    const product = allProducts().find((candidate) => candidate.id === id)
    return product ? saveProduct({ ...product, archived }) : Promise.resolve(false)
  }, 'catCare.archiveProduct')
  const saveFood = action(async (food: FoodRecord) => {
    const saved = await wrap(runCommand({ kind: 'food.save', food }))
    if (saved)
      lastPortions.set({
        ...lastPortions(),
        [food.productId]: { grams: food.grams, mode: food.mode },
      })
    return saved
  }, 'catCare.saveFood')
  const saveWater = action(
    (value: WaterRecord) => runCommand({ kind: 'water.save', water: value }),
    'catCare.saveWater',
  )
  const saveWeight = action(
    (value: WeightRecord) => runCommand({ kind: 'weight.save', weight: value }),
    'catCare.saveWeight',
  )
  const deleteRecord = action(
    (entity: 'food' | 'water' | 'weight', recordId: string) =>
      runCommand({ kind: 'record.delete', entity, recordId }),
    'catCare.deleteRecord',
  )

  const loading = computed(() => {
    ledger()
    return (ledger.isLoading() && !ledger.error() && !refresh.error()) || !refresh.ready()
  }, 'catCare.loading')
  const loadError = computed(
    () =>
      ledger.error() || refresh.error()
        ? 'Не удалось загрузить дневник. Проверьте соединение и повторите.'
        : null,
    'catCare.loadError',
  )
  const mutationPending = computed(() => !performWrite.ready(), 'catCare.mutationPending')
  const mutationError = computed(() => publicError(performWrite.error()), 'catCare.mutationError')

  return {
    state,
    viewer: identity.viewer,
    recordAuthors,
    profile,
    products,
    allProducts,
    foods,
    water,
    weights,
    selectedDate,
    periodDays,
    activeTab,
    lastPortions,
    today,
    nowMs,
    daySummary,
    periodSummary,
    waterIntervals,
    latestWeight,
    weightSeries,
    energyEstimate,
    loading,
    loadError,
    mutationPending,
    mutationError,
    saveProfile,
    saveProduct,
    archiveProduct,
    saveFood,
    saveWater,
    saveWeight,
    deleteRecord,
    retryLoad,
  }
}

export type CatCareModel = ReturnType<typeof createCatCareModel>
