import { action, atom, computed, wrap } from '@reatom/core'
import type { AtomLike, Computed } from '@reatom/core'
import { withStorageKeyReadonly } from 'widget-runtime'
import type { StorageApi, StorageError } from 'widget-runtime'

import { EntityIdSchema } from '../domain/ids'
import { CARD_CAT_KEY, CARD_LITTER_KEY } from '../domain/keys'
import { KEY_LOADING, type CatModel, type Loadable } from './cat-model'
import type { CatSummary, CatsModel, LitterSummary } from './cats-model'
import type { LitterModel } from './litter-model'

/** One card's choice among the offered options: the stored one, else the first, never written back. */
export type CardChoice<Option extends { id: string }> = {
  /** null while the module or registry is loading. */
  options: Computed<Option[] | null>
  /** The stored id if it is among `options`, else `options[0]`; null while loading or with no options. */
  current: Computed<Option | null>
  canSwitch: Computed<boolean>
  /**
   * The only writer of the key. Any valid entity id is written, offered yet or not: a card
   * chooses a cat as soon as it is added, before the registry reaches `options`.
   */
  choose(id: string): Promise<StorageError | void>
}

export type CatCardChoice = CardChoice<CatSummary> & { cat: Computed<CatModel | null> }

export type LitterOption = LitterSummary & { cats: CatSummary[] }

export type LitterCardChoice = CardChoice<LitterOption> & { litter: Computed<LitterModel | null> }

export type CardChoiceInput = {
  model: AtomLike<CatsModel | null>
  /** The widget's instance storage, server side: the choice follows the board across devices. */
  storage: StorageApi
  /** Prefix of the atom names. */
  name: string
}

/** Every offered litter with its cats in `catIds` order; null while the module is loading. */
export function makeLitterOptions(
  model: AtomLike<CatsModel | null>,
  name = 'cats.litterOptions',
): Computed<LitterOption[] | null> {
  return computed(() => {
    const cats = model()
    const litters = cats?.litters()
    const active = cats?.cats()
    if (!litters || !active) return null
    return litters.map((litter) => ({
      ...litter,
      cats: litter.catIds.flatMap((id) => active.filter((cat) => cat.id === id)),
    }))
  }, name)
}

function makeCardChoice<Option extends { id: string }>(
  options: Computed<Option[] | null>,
  storage: StorageApi,
  key: string,
  name: string,
): CardChoice<Option> {
  const stored = atom<unknown>(KEY_LOADING, `${name}.stored`).extend(
    withStorageKeyReadonly({ api: storage, key, fallback: null }),
  )

  const storedId = computed<Loadable<string | null>>(() => {
    const raw = stored()
    if (raw === KEY_LOADING) return KEY_LOADING
    const parsed = EntityIdSchema.safeParse(raw)
    return parsed.success ? parsed.data : null
  }, `${name}.storedId`)

  const current = computed<Option | null>(() => {
    const offered = options()
    const id = storedId()
    if (offered === null || id === KEY_LOADING) return null
    return offered.find((option) => option.id === id) ?? offered[0] ?? null
  }, `${name}.current`)

  const canSwitch = computed(() => (options()?.length ?? 0) > 1, `${name}.canSwitch`)

  const choose = action(async (id: string): Promise<StorageError | void> => {
    if (!EntityIdSchema.safeParse(id).success) return
    return await wrap(storage.set(key, id))
  }, `${name}.choose`)

  return { options, current, canSwitch, choose }
}

export function makeCatChoice({ model, storage, name }: CardChoiceInput): CatCardChoice {
  const options = computed(() => model()?.cats() ?? null, `${name}.catOptions`)
  const choice = makeCardChoice(options, storage, CARD_CAT_KEY, `${name}.cat`)
  const cat = computed(() => {
    const current = choice.current()
    return current ? (model()?.cat(current.id) ?? null) : null
  }, `${name}.catModel`)
  return { ...choice, cat }
}

export function makeLitterChoice({ model, storage, name }: CardChoiceInput): LitterCardChoice {
  const options = makeLitterOptions(model, `${name}.litterOptions`)
  const choice = makeCardChoice(options, storage, CARD_LITTER_KEY, `${name}.litter`)
  const litter = computed(() => {
    const current = choice.current()
    return current ? (model()?.litter(current.id) ?? null) : null
  }, `${name}.litterModel`)
  return { ...choice, litter }
}
