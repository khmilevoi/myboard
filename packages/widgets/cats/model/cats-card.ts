import { atom, computed } from '@reatom/core'
import type { Atom, Computed } from '@reatom/core'
import { MONTHS_SHORT } from '@shared/format/ru'
import { catsModule, type CatsModel } from 'module-cats'
import { makeCatChoice, type CatCardChoice } from 'module-cats/card-choice'
import { resolveEntryAuthor, type EntryAuthor } from 'module-cats/domain/author'
import { daysSinceWeighing, latestWeighing, weightTrend } from 'module-cats/domain/cat'
import { formatAge, sexLabel, sterilizedLabel } from 'module-cats/format'
import { makeWeighForm, type WeighForm } from 'module-cats/weigh-form'
import type { StorageApi, WidgetIdentity, WidgetModules } from 'widget-runtime'
import { makeWidgetInstanceStore } from 'widget-sdk'
import { reatomModule, type ReatomModule } from 'widget-sdk/modules/reatom-module'

import { makeGoalForm, type GoalForm } from './goal-form'
import { makeProfileForm, type ProfileForm } from './profile-form'

/** The fullscreen tabs. "Профиль" and "+ Добавить кошку" pick one before opening fullscreen. */
export type CatsTab = 'profile' | 'weight' | 'all'

/** What the card shows: the cat's passport, or why it cannot yet. */
export type CatsCardStatus = 'loading' | 'error' | 'empty' | 'ready'

export type CatsPassport = {
  name: string
  breed: string | null
  /** "3 года 2 мес"; null without a birth date or before the clock syncs. */
  ageLong: string | null
  /** "3 года". */
  ageShort: string | null
  sexLabel: string | null
  sterilizedLabel: string | null
  bodyCondition: number | null
  goalToday: number | null
}

export type CatsWeight = {
  kg: number
  /** Grams against the weighing at least 30 days older; null with none that old. */
  trend30: number | null
  /** Whole days since the latest weighing; null before the clock syncs. */
  daysAgo: number | null
  author: EntryAuthor
  /** Two weeks or more without a weighing: the calorie goal rests on an old weight. */
  stale: boolean
}

export type CatsSparkPoint = { at: string; kg: number }
export type CatsSparkLabel = { at: string; label: string }

/** Days of weighings the sparkline shows. */
export const SPARK_DAYS = 90
/** Days without a weighing after which the weight counts as old. */
export const STALE_DAYS = 14

export type CatsCardView = {
  /** null while the chosen cat or its profile is loading. */
  passport: Computed<CatsPassport | null>
  /** null while loading and when the cat has never been weighed. */
  weight: Computed<CatsWeight | null>
  /** The weighings of the last `SPARK_DAYS` days, oldest first. */
  spark: Computed<CatsSparkPoint[]>
  /** One upper-cased short month name per month the sparkline spans: "СЕН", "ОКТ", "НОЯ". */
  sparkLabels: Computed<CatsSparkLabel[]>
}

export type CatsCard = {
  handle: ReatomModule<CatsModel>
  choice: CatCardChoice
  tab: Atom<CatsTab>
  status: Computed<CatsCardStatus>
  /** The one "Вес" form of this card: every "Взвесить" opens `WeighDialog` with it. */
  weighForm: WeighForm
  /** The "Профиль" tab's draft: shared by both mounts, so it survives opening fullscreen. */
  profileForm: ProfileForm
  goalForm: GoalForm
  view: CatsCardView
}

export type MakeCatsCardInput = {
  modules: WidgetModules
  /** The widget's instance storage, server side: the card's choice of cat. */
  storage: StorageApi
  /** Resolves a weighing's author against the board's members. */
  identity: WidgetIdentity
  /** Prefix of the atom names. */
  name?: string
}

/** The model of one "Кошки" card: the chosen cat, its passport view and the weigh form. */
export function makeCatsCard({
  modules,
  storage,
  identity,
  name = 'catsCard',
}: MakeCatsCardInput): CatsCard {
  const handle = reatomModule({ modules, module: catsModule, name: `${name}.module` })
  const choice = makeCatChoice({ model: handle.model, storage, name: `${name}.choice` })
  const tab = atom<CatsTab>('profile', `${name}.tab`)
  const today = computed(() => handle.model()?.today() ?? null, `${name}.today`)
  const weighForm = makeWeighForm(choice.cat, today, `${name}.weighForm`)
  const profileForm = makeProfileForm({
    cat: choice.cat,
    model: handle.model,
    name: `${name}.profileForm`,
  })
  const goalForm = makeGoalForm(choice.cat, today, `${name}.goalForm`)

  const status = computed((): CatsCardStatus => {
    if (handle.model() === null) return handle.error() === null ? 'loading' : 'error'
    const options = choice.options()
    if (options === null) return 'loading'
    if (options.length === 0) return 'empty'
    const cat = choice.cat()
    if (cat === null || cat.profile() === null || cat.weighings() === null) return 'loading'
    return 'ready'
  }, `${name}.status`)

  const passport = computed((): CatsPassport | null => {
    const cat = choice.cat()
    const profile = cat?.profile() ?? null
    if (cat === null || profile === null) return null
    const day = today()
    const birth = profile.birthDate === null ? null : Temporal.PlainDate.from(profile.birthDate)
    const age = (form: 'long' | 'short') =>
      birth === null || day === null ? null : formatAge(birth, day, form)
    return {
      name: profile.name,
      breed: profile.breed,
      ageLong: age('long'),
      ageShort: age('short'),
      sexLabel: sexLabel(profile.sex),
      sterilizedLabel: sterilizedLabel(profile.sterilized, profile.sex),
      bodyCondition: profile.bodyCondition,
      goalToday: cat.goalToday(),
    }
  }, `${name}.passport`)

  const weight = computed((): CatsWeight | null => {
    const weighings = choice.cat()?.weighings() ?? null
    const latest = weighings === null ? null : latestWeighing(weighings)
    if (weighings === null || latest === null) return null
    const day = today()
    const daysAgo = day === null ? null : daysSinceWeighing(weighings, day)
    return {
      kg: latest.kg,
      trend30: weightTrend(weighings, 30),
      daysAgo,
      author: resolveEntryAuthor(latest.createdBy, undefined, identity.members()),
      stale: daysAgo !== null && daysAgo >= STALE_DAYS,
    }
  }, `${name}.weight`)

  // The range excludes its first day (`at > today − 90`), as the weight history's ranges do.
  const spark = computed((): CatsSparkPoint[] => {
    const weighings = choice.cat()?.weighings() ?? null
    const day = today()
    if (weighings === null || day === null) return []
    const from = day.subtract({ days: SPARK_DAYS }).toString()
    return weighings
      .filter((weighing) => weighing.at > from)
      .toSorted((a, b) => (a.at === b.at ? a.ts - b.ts : a.at < b.at ? -1 : 1))
      .map(({ at, kg }) => ({ at, kg }))
  }, `${name}.spark`)

  const sparkLabels = computed((): CatsSparkLabel[] => {
    const points = spark()
    const first = points[0]
    const last = points.at(-1)
    if (first === undefined || last === undefined) return []
    const end = Temporal.PlainDate.from(last.at).toPlainYearMonth()
    const labels: CatsSparkLabel[] = []
    for (
      let month = Temporal.PlainDate.from(first.at).toPlainYearMonth();
      Temporal.PlainYearMonth.compare(month, end) <= 0;
      month = month.add({ months: 1 })
    ) {
      // The first label sits at the first point, the others on the first of their month.
      const at = labels.length === 0 ? first.at : month.toPlainDate({ day: 1 }).toString()
      labels.push({ at, label: MONTHS_SHORT[month.month - 1].toUpperCase() })
    }
    return labels
  }, `${name}.sparkLabels`)

  return {
    handle,
    choice,
    tab,
    status,
    weighForm,
    profileForm,
    goalForm,
    view: { passport, weight, spark, sparkLabels },
  }
}

/**
 * One card per placed "Кошки" widget, shared by its board tile and its fullscreen mount: the
 * choice, the tab and a half-typed weight survive opening and closing fullscreen.
 */
export const catsCardStore = makeWidgetInstanceStore<CatsCard>({ name: 'catsCard' })
