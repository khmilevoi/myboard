import { action, atom, computed, wrap } from '@reatom/core'
import type { Computed } from '@reatom/core'
import { fileUrl, type FileRef } from '@shared/files/contract'
import { StorageError, withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError } from 'widget-runtime'

import {
  CatProfileSchema,
  GoalEntriesSchema,
  WeighingsSchema,
  goalOn,
  latestWeighing,
  type CatProfile,
  type CatProfileFields,
  type GoalEntry,
  type LitterChoice,
  type Weighing,
} from '../domain/cat'
import { catAvatarSlotKey, catGoalKey, catProfileKey, catWeightKey } from '../domain/keys'
import { DUTY_TIME_ZONE } from '../domain/roster'
import type { CatsModuleContext } from './litter-model'

/** A raw key value before the key has answered: distinct from an absent key (null). */
export const KEY_LOADING = Symbol('cats.keyLoading')
export type Loadable<T> = typeof KEY_LOADING | T

/** One cat: its profile, weighings and daily goal, and the actions that write them. */
export type CatModel = {
  /** null while loading, and when the profile key is absent or does not parse. */
  profile: Computed<CatProfile | null>
  /** null while loading; an absent or unparseable key is an empty list. */
  weighings: Computed<Weighing[] | null>
  latestWeighing: Computed<Weighing | null>
  /** null while loading; an absent or unparseable key is an empty list. */
  goals: Computed<GoalEntry[] | null>
  /**
   * A failed first read of the weighings or the goals: they would otherwise stay null (loading) for
   * good, since the subscription reads once and then only waits for a live change. null once both
   * have answered. A failed profile read is not here: the profile then reads as absent.
   */
  loadError: Computed<StorageError | null>
  /** Reads every key whose first read failed again; each answer settles only its own key. */
  retry(): Promise<void>
  /** `goalOn` at the server-time today; null while loading or before the clock syncs. */
  goalToday: Computed<number | null>
  /**
   * The avatar's URL: the file slot's `FileRef` is its only source of truth, so `profile.avatar`
   * is never read or written. null while the slot is empty or loading.
   */
  avatarUrl: Computed<string | null>
  /** Uploads a ready (already cropped) image into the slot, replacing the old blob. */
  uploadAvatar(image: Blob): Promise<StorageError | FileRef>
  removeAvatar(): Promise<StorageError | void>
  saveProfile(profile: CatProfileFields, litter: LitterChoice): Promise<ModuleApiError | void>
  weigh(kg: number, at: Temporal.PlainDate): Promise<ModuleApiError | void>
  setGoal(kcal: number, since: Temporal.PlainDate): Promise<ModuleApiError | void>
}

/** What `CatsModel` needs beyond the public surface: loading told apart from an absent profile. */
export type CatModelInternals = {
  model: CatModel
  /** `KEY_LOADING` until the profile key answers, then the parsed profile or null. */
  profileState: Computed<Loadable<CatProfile | null>>
}

/**
 * The model of one cat. Build it through `CatsModel.cat(id)`, which memoizes it. Every key is read
 * raw and parsed here, never through the subscription's schema: the keys are writable through the
 * generic storage endpoint, and a value that fails a schema there would become a subscription
 * error that pins the computeds at null instead of reading as absent.
 */
export function makeCatModel(context: CatsModuleContext, catId: string): CatModelInternals {
  const { storage, timer, api, files } = context
  const server = storage.shared.server
  const name = (suffix: string) => `cats.cat.${catId}.${suffix}`

  const rawKey = (key: string, suffix: string) =>
    atom<unknown>(KEY_LOADING, name(suffix)).extend(
      withStorageKeyReadonly({ api: server, key, fallback: null }),
    )
  const rawProfile = rawKey(catProfileKey(catId), 'rawProfile')
  const rawWeighings = rawKey(catWeightKey(catId), 'rawWeighings')
  const rawGoals = rawKey(catGoalKey(catId), 'rawGoals')

  const avatarSlot = files('shared', catAvatarSlotKey(catId))
  const avatarUrl = computed(() => {
    const ref = avatarSlot.ref()
    return ref === null ? null : fileUrl(ref.blobId)
  }, name('avatarUrl'))

  const profileState = computed<Loadable<CatProfile | null>>(() => {
    const raw = rawProfile()
    // A failed read never sets the atom, so it must not read as loading forever: that would hold
    // `cats()`, and with it every cat and litter card, on a skeleton. It reads as absent instead,
    // so the cat is left out, as a profile that does not parse is.
    if (raw === KEY_LOADING) return rawProfile.error() === null ? KEY_LOADING : null
    const parsed = CatProfileSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, name('profileState'))

  const profile = computed(() => {
    const state = profileState()
    return state === KEY_LOADING ? null : state
  }, name('profile'))

  const weighings = computed<Weighing[] | null>(() => {
    const raw = rawWeighings()
    if (raw === KEY_LOADING) return null
    const parsed = WeighingsSchema.safeParse(raw ?? [])
    return parsed.success ? parsed.data : []
  }, name('weighings'))

  const latest = computed(() => {
    const current = weighings()
    return current === null ? null : latestWeighing(current)
  }, name('latestWeighing'))

  const goals = computed<GoalEntry[] | null>(() => {
    const raw = rawGoals()
    if (raw === KEY_LOADING) return null
    const parsed = GoalEntriesSchema.safeParse(raw ?? [])
    return parsed.success ? parsed.data : []
  }, name('goals'))

  const loadError = computed(() => {
    const weighingsError = rawWeighings() === KEY_LOADING ? rawWeighings.error() : null
    const goalsError = rawGoals() === KEY_LOADING ? rawGoals.error() : null
    return weighingsError ?? goalsError
  }, name('loadError'))

  // Re-runs the one-shot read `withStorageKeyReadonly` made at connect time, for each key whose
  // read failed, with the same `get` the subscription is built on.
  const retry = action(async () => {
    const failed = [
      { raw: rawProfile, key: catProfileKey(catId) },
      { raw: rawWeighings, key: catWeightKey(catId) },
      { raw: rawGoals, key: catGoalKey(catId) },
    ].filter(({ raw }) => raw() === KEY_LOADING && raw.error() !== null)
    const answers = await wrap(Promise.all(failed.map(({ key }) => server.get(key))))
    failed.forEach(({ raw }, index) => {
      const answer = answers[index]
      // Read without a schema, so the value is `unknown`; the only Error `get` returns is a
      // StorageError.
      if (answer instanceof StorageError) {
        raw.error.set(answer)
        return
      }
      raw.error.set(null)
      // A live change may have answered while the read was in flight; it is newer.
      if (raw() === KEY_LOADING) raw.set(answer ?? null)
    })
  }, name('retry'))

  const goalToday = computed(() => {
    const today = timer.today(DUTY_TIME_ZONE)
    const current = goals()
    if (today === null || current === null) return null
    return goalOn(current, today)
  }, name('goalToday'))

  // Pure intent, like the litter's day actions: the server checks the cat exists and stamps the
  // weighing's author. Failures are returned as values; nothing after the await touches an atom.
  const saveProfile = action(
    async (fields: CatProfileFields, litter: LitterChoice): Promise<ModuleApiError | void> => {
      const result = await wrap(api.invoke('saveProfile', { catId, profile: fields, litter }))
      if (result instanceof Error) return result
    },
    name('saveProfile'),
  )

  const weigh = action(
    async (kg: number, at: Temporal.PlainDate): Promise<ModuleApiError | void> => {
      const result = await wrap(api.invoke('weigh', { catId, kg, at: at.toString() }))
      if (result instanceof Error) return result
    },
    name('weigh'),
  )

  const setGoal = action(
    async (kcal: number, since: Temporal.PlainDate): Promise<ModuleApiError | void> => {
      const result = await wrap(api.invoke('setGoal', { catId, kcal, since: since.toString() }))
      if (result instanceof Error) return result
    },
    name('setGoal'),
  )

  return {
    model: {
      profile,
      weighings,
      latestWeighing: latest,
      goals,
      loadError,
      retry,
      goalToday,
      avatarUrl,
      uploadAvatar: avatarSlot.upload,
      removeAvatar: avatarSlot.remove,
      saveProfile,
      weigh,
      setGoal,
    },
    profileState,
  }
}
