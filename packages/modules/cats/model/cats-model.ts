import { action, atom, computed, wrap } from '@reatom/core'
import type { Computed } from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { ModuleApiError } from 'widget-runtime'

import {
  catToneAt,
  litterTitle,
  type CatProfile,
  type CatTone,
  type LitterChoice,
} from '../domain/cat'
import { CATS_REGISTRY_KEY, LITTERS_REGISTRY_KEY } from '../domain/keys'
import {
  CatRegistryEventsSchema,
  LitterRegistryEventsSchema,
  foldCatRegistry,
  foldLitterRegistry,
  type CatRegistry,
} from '../domain/registry'
import { DUTY_TIME_ZONE } from '../domain/roster'
import { KEY_LOADING, makeCatModel, type CatModel, type CatModelInternals } from './cat-model'
import { makeLitterModel, type CatsModuleContext, type LitterModel } from './litter-model'

export type CatSummary = {
  id: string
  name: string
  avatar: string | null
  litterId: string
  /** Fixed by the cat's position in the registry's add order, so it never changes. */
  tone: CatTone
}

export type LitterSummary = { id: string; title: string; catIds: string[] }

/** The one cats-module model per board. Per-entity state lives in memoized sub-models. */
export type CatsModel = {
  /** The server-time calendar day in the duty time zone; null until the clock syncs. */
  today: Computed<Temporal.PlainDate | null>
  /**
   * Active cats in registry order. null until the registry and every active cat's profile have
   * loaded; a registry id whose profile is absent or does not parse is left out.
   */
  cats: Computed<CatSummary[] | null>
  archivedCats: Computed<CatSummary[] | null>
  /** Litters at least one active cat points at, in litter-registry order. */
  litters: Computed<LitterSummary[] | null>
  /** The same `CatModel` for the same id, so every view of a cat shares its atoms. */
  cat(catId: string): CatModel
  /** The same `LitterModel` for the same id, so every view of a litter shares its atoms. */
  litter(litterId: string): LitterModel
  addCat(name: string, litter: LitterChoice): Promise<ModuleApiError | { catId: string }>
  archiveCat(catId: string): Promise<ModuleApiError | void>
  restoreCat(catId: string): Promise<ModuleApiError | void>
}

export function makeCatsModel(context: CatsModuleContext): CatsModel {
  const { storage, timer, api } = context
  const server = storage.shared.server
  const litterModels = new Map<string, LitterModel>()
  const catModels = new Map<string, CatModelInternals>()

  const litter = (litterId: string): LitterModel => {
    let model = litterModels.get(litterId)
    if (!model) {
      model = makeLitterModel(context, litterId)
      litterModels.set(litterId, model)
    }
    return model
  }

  const catInternals = (catId: string): CatModelInternals => {
    let internals = catModels.get(catId)
    if (!internals) {
      internals = makeCatModel(context, catId)
      catModels.set(catId, internals)
    }
    return internals
  }

  const cat = (catId: string): CatModel => catInternals(catId).model

  // Both registries are read raw and parsed in the computeds, as the cat keys are: a hand-written
  // junk value reads as an empty log instead of a subscription error.
  const rawCatRegistry = atom<unknown>(KEY_LOADING, 'cats.rawCatRegistry').extend(
    withStorageKeyReadonly({ api: server, key: CATS_REGISTRY_KEY, fallback: null }),
  )
  const rawLitterRegistry = atom<unknown>(KEY_LOADING, 'cats.rawLitterRegistry').extend(
    withStorageKeyReadonly({ api: server, key: LITTERS_REGISTRY_KEY, fallback: null }),
  )

  const catRegistry = computed<CatRegistry | null>(() => {
    const raw = rawCatRegistry()
    if (raw === KEY_LOADING) return null
    const parsed = CatRegistryEventsSchema.safeParse(raw ?? [])
    return foldCatRegistry(parsed.success ? parsed.data : [])
  }, 'cats.catRegistry')

  const litterIds = computed<string[] | null>(() => {
    const raw = rawLitterRegistry()
    if (raw === KEY_LOADING) return null
    const parsed = LitterRegistryEventsSchema.safeParse(raw ?? [])
    return foldLitterRegistry(parsed.success ? parsed.data : [])
  }, 'cats.litterIds')

  // Every profile is read before deciding, so all of them subscribe in the same run instead of
  // one per recomputation. Reading a cat's `profileState` here is what connects its profile key:
  // the dependency list follows the registry, so an id that leaves it is disconnected.
  const summaries = (catIds: readonly string[], order: readonly string[]): CatSummary[] | null => {
    const states = catIds.map(
      (id): { id: string; state: ReturnType<CatModelInternals['profileState']> } => ({
        id,
        state: catInternals(id).profileState(),
      }),
    )
    if (states.some(({ state }) => state === KEY_LOADING)) return null
    return states.flatMap(({ id, state }) => {
      if (state === KEY_LOADING || state === null) return []
      return [toSummary(id, state, catToneAt(order.indexOf(id)))]
    })
  }

  const today = computed(() => timer.today(DUTY_TIME_ZONE), 'cats.today')

  const cats = computed(() => {
    const registry = catRegistry()
    return registry === null ? null : summaries(registry.active, registry.order)
  }, 'cats.cats')

  const archivedCats = computed(() => {
    const registry = catRegistry()
    return registry === null
      ? null
      : summaries(
          registry.archived.map(({ catId }) => catId),
          registry.order,
        )
  }, 'cats.archivedCats')

  const litters = computed<LitterSummary[] | null>(() => {
    const ids = litterIds()
    const active = cats()
    if (ids === null || active === null) return null
    return ids.flatMap((id) => {
      const users = active.filter((summary) => summary.litterId === id)
      if (users.length === 0) return []
      return [
        {
          id,
          title: litterTitle(users.map((summary) => summary.name)),
          catIds: users.map((summary) => summary.id),
        },
      ]
    })
  }, 'cats.litters')

  // The server generates the id, checks the litter and enforces the last-active rule; the model
  // only carries intent. Failures are returned as values; nothing after the await touches an atom.
  const addCat = action(
    async (
      name: string,
      litterChoice: LitterChoice,
    ): Promise<ModuleApiError | { catId: string }> => {
      const result = await wrap(api.invoke('addCat', { name, litter: litterChoice }))
      if (result instanceof Error) return result
      return { catId: result.catId }
    },
    'cats.addCat',
  )

  const archiveCat = action(async (catId: string): Promise<ModuleApiError | void> => {
    const result = await wrap(api.invoke('archiveCat', { catId }))
    if (result instanceof Error) return result
  }, 'cats.archiveCat')

  const restoreCat = action(async (catId: string): Promise<ModuleApiError | void> => {
    const result = await wrap(api.invoke('restoreCat', { catId }))
    if (result instanceof Error) return result
  }, 'cats.restoreCat')

  return { today, cats, archivedCats, litters, cat, litter, addCat, archiveCat, restoreCat }
}

function toSummary(id: string, profile: CatProfile, tone: CatTone): CatSummary {
  return { id, name: profile.name, avatar: profile.avatar, litterId: profile.litterId, tone }
}
