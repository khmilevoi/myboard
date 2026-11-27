import { action, atom, computed, withAsync, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import { instrumental } from '@shared/format/ru'
import type { CatSummary, CatsModel } from 'module-cats'
import { makeLitterOptions } from 'module-cats/card-choice'
import type { LitterChoice } from 'module-cats/domain/cat'
import type { ModuleApiError } from 'widget-runtime'

import { NAME_ISSUE, NEW_LITTER_VALUE } from './profile-form'

export const ADD_FAILED = 'Не удалось добавить кошку. Попробуйте ещё раз.'

/** One choice of the "Лоток" field: a litter a cat already uses, or a new one of its own. */
export type AddCatLitterOption = {
  /** The toggle value: the litter id, or `NEW_LITTER_VALUE`. */
  value: string
  choice: LitterChoice
  /** "Общий с Офелией" or "Свой лоток". */
  title: string
  /** "та же очередь" or "новая очередь". */
  note: string
  /** The cats already on the litter, for its avatar; empty for a new one. */
  cats: CatSummary[]
}

export type AddCatIssues = { name?: string }

export type AddCatForm = ReturnType<typeof makeAddCatForm>

export type MakeAddCatFormInput = {
  /** Runs once a cat is added, with its id: the card chooses it and opens its profile. */
  onAdded?: (catId: string) => void
  /** Prefix of the atom names. */
  name?: string
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
}

/**
 * The "Новая кошка" form: a name, a birth date and a sex, on a litter another cat uses or a new
 * one. Everything else (breed, weight, goal) is the profile's job. Defaults: a female cat on a
 * litter of her own, no birth date.
 */
export function makeAddCatForm(
  cats: AtomLike<CatsModel | null>,
  { onAdded, name = 'addCatForm' }: MakeAddCatFormInput = {},
) {
  const nameText = atom('', `${name}.name`)
  /** A date input's value (`YYYY-MM-DD`), null while empty. */
  const birthDate = atom<string | null>(null, `${name}.birthDate`)
  const sex = atom<'female' | 'male'>('female', `${name}.sex`)
  const litter = atom<LitterChoice>({ kind: 'new' }, `${name}.litter`)
  /** Whether a submit already found the form incomplete: only then does it complain. */
  const attempted = atom(false, `${name}.attempted`)

  const trimmed = computed(() => nameText().trim(), `${name}.trimmed`)

  const issues = computed(
    (): AddCatIssues => (attempted() && trimmed() === '' ? { name: NAME_ISSUE } : {}),
    `${name}.issues`,
  )

  /** The inputs a failed add was sent with, so editing any of them forgets the failure. */
  const inputs = computed(
    () => JSON.stringify([nameText(), birthDate(), sex(), litter()]),
    `${name}.inputs`,
  )
  const failedWith = atom<string | null>(null, `${name}.failedWith`)
  const failed = computed(() => failedWith() === inputs(), `${name}.failed`)

  const offered = makeLitterOptions(cats, `${name}.offeredLitters`)
  const litterOptions = computed((): AddCatLitterOption[] | null => {
    const list = offered()
    if (list === null) return null
    return [
      ...list.map(
        (option): AddCatLitterOption => ({
          value: option.id,
          choice: { kind: 'existing', litterId: option.id },
          title: `Общий с ${joinNames(
            option.cats.map((cat) =>
              instrumental(cat.name, cats()?.cat(cat.id).profile()?.sex ?? null),
            ),
          )}`,
          note: 'та же очередь',
          cats: option.cats,
        }),
      ),
      {
        value: NEW_LITTER_VALUE,
        choice: { kind: 'new' },
        title: 'Свой лоток',
        note: 'новая очередь',
        cats: [],
      },
    ]
  }, `${name}.litterOptions`)

  const reset = action(() => {
    nameText.set('')
    birthDate.set(null)
    sex.set('female')
    litter.set({ kind: 'new' })
    attempted.set(false)
    failedWith.set(null)
  }, `${name}.reset`)

  /**
   * The form closed without adding: a refused submit and a failed add are forgotten, so reopening
   * it shows no stale message; the typed draft stays.
   */
  const dismiss = action(() => {
    attempted.set(false)
    failedWith.set(null)
  }, `${name}.dismiss`)

  /** Sends the cat; undefined when the form is incomplete (nothing is sent). */
  const submit = action(async (): Promise<ModuleApiError | { catId: string } | void> => {
    const model = cats()
    if (model === null) return
    if (trimmed() === '') {
      attempted.set(true)
      return
    }
    const sent = inputs()
    const result = await wrap(
      model.addCat(trimmed(), litter(), { birthDate: birthDate(), sex: sex() }),
    )
    if (result instanceof Error) {
      failedWith.set(sent)
      return result
    }
    reset()
    onAdded?.(result.catId)
    return result
  }, `${name}.submit`).extend(withAsync())

  const saving = computed(() => !submit.ready(), `${name}.saving`)

  /** The date input's `max`: a cat is not born after today (server time). */
  const maxBirthDate = computed(() => cats()?.today() ?? null, `${name}.maxBirthDate`)

  return {
    name: nameText,
    birthDate,
    maxBirthDate,
    sex,
    litter,
    litterOptions,
    issues,
    failed,
    saving,
    reset,
    dismiss,
    submit,
  }
}
