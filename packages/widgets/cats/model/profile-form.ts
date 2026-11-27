import { action, atom, computed, withAsync, withComputed, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { CatModel, CatSummary, CatsModel } from 'module-cats'
import { makeLitterOptions } from 'module-cats/card-choice'
import {
  CatProfileFieldsSchema,
  type CatProfile,
  type CatProfileFields,
  type LitterChoice,
} from 'module-cats/domain/cat'
import type { ModuleApiError } from 'widget-runtime'

export const NAME_ISSUE = 'Укажите имя'
export const BODY_CONDITION_ISSUE = 'От 1 до 9'

/** The toggle value of "+ Новый лоток": a `+` never occurs in an entity id, so it never collides. */
export const NEW_LITTER_VALUE = '+new'

/** One choice of the "Лоток" field: a litter in the registry, or a new one of the cat's own. */
export type ProfileLitterOption = {
  /** The toggle value: the litter id, or `NEW_LITTER_VALUE`. */
  value: string
  choice: LitterChoice
  title: string
  /** The second line: the litter's rotation ("Леша и Карина"), or "своя очередь"; null while loading. */
  note: string | null
  /** The cats on the litter, for its avatar; empty for a new one. */
  cats: CatSummary[]
}

export type ProfileIssues = Partial<Record<keyof CatProfileFields, string>>

export type ProfileForm = ReturnType<typeof makeProfileForm>

export type MakeProfileFormInput = {
  cat: AtomLike<CatModel | null>
  model: AtomLike<CatsModel | null>
  /** Prefix of the atom names. */
  name?: string
}

/**
 * What the user changed, against the profile it started from. While `saved` the entry only holds
 * the sent values on screen until the profile key answers with them (`source` changes).
 */
type Edits = {
  model: CatModel
  /** The profile object the entry was made against (or, once saved, the one current then). */
  source: CatProfile
  baseFields: CatProfileFields
  baseLitter: LitterChoice
  fields: CatProfileFields
  litter: LitterChoice
  saved: boolean
}

const FIELD_KEYS = Object.keys(CatProfileFieldsSchema.shape) as (keyof CatProfileFields)[]

function fieldsOf(profile: CatProfile): CatProfileFields {
  const { litterId: _litterId, ...fields } = profile
  return fields
}

export function litterValue(choice: LitterChoice): string {
  return choice.kind === 'new' ? NEW_LITTER_VALUE : choice.litterId
}

function sameFields(a: CatProfileFields, b: CatProfileFields): boolean {
  return FIELD_KEYS.every((key) => a[key] === b[key])
}

function sameLitter(a: LitterChoice, b: LitterChoice): boolean {
  return litterValue(a) === litterValue(b)
}

function isDirty(edits: Edits | null): edits is Edits {
  if (edits === null || edits.saved) return false
  return !sameFields(edits.fields, edits.baseFields) || !sameLitter(edits.litter, edits.baseLitter)
}

/** Whether the entry, not the live profile, is what the form shows. */
function isShown(edits: Edits | null): edits is Edits {
  return edits !== null && (edits.saved || isDirty(edits))
}

/**
 * The "Профиль" tab's form for one cat. The draft copies the profile when it loads, and follows
 * every later profile change only while the form is clean: a live update from another device
 * never overwrites what the user is typing, and "Сохранить" sends the draft as it is on screen.
 */
export function makeProfileForm({ cat, model, name = 'profileForm' }: MakeProfileFormInput) {
  const live = computed(() => {
    const current = cat()
    const profile = current?.profile() ?? null
    return current === null || profile === null ? null : { model: current, profile }
  }, `${name}.live`)

  // Dropped when the cat changes, and a saved entry once the profile key answers again.
  const edits = atom<Edits | null>(null, `${name}.edits`).extend(
    withComputed((state) => {
      const current = live()
      if (state === null || current === null || state.model !== current.model) return null
      if (state.saved && current.profile !== state.source) return null
      return state
    }),
  )

  const saveFailed = atom(false, `${name}.saveFailed`)

  const draft = computed((): CatProfileFields | null => {
    const entry = edits()
    if (isShown(entry)) return entry.fields
    const current = live()
    return current === null ? null : fieldsOf(current.profile)
  }, `${name}.draft`)

  const litter = computed((): LitterChoice | null => {
    const entry = edits()
    if (isShown(entry)) return entry.litter
    const current = live()
    return current === null ? null : { kind: 'existing', litterId: current.profile.litterId }
  }, `${name}.litter`)

  const dirty = computed(() => isDirty(edits()), `${name}.dirty`)

  const issues = computed((): ProfileIssues => {
    const current = draft()
    if (current === null) return {}
    const parsed = CatProfileFieldsSchema.safeParse(current)
    if (parsed.success) return {}
    const found: ProfileIssues = {}
    for (const issue of parsed.error.issues) {
      const [key] = issue.path
      if (key === 'name') found.name = NAME_ISSUE
      if (key === 'bodyCondition') found.bodyCondition = BODY_CONDITION_ISSUE
    }
    return found
  }, `${name}.issues`)

  /** The entry to build the next change on: the one on screen, else a fresh one from the profile. */
  const startEdit = (): Edits | null => {
    const current = live()
    if (current === null) return null
    const entry = edits()
    if (isShown(entry)) return { ...entry, saved: false }
    const fields = fieldsOf(current.profile)
    const litterChoice: LitterChoice = { kind: 'existing', litterId: current.profile.litterId }
    return {
      model: current.model,
      source: current.profile,
      baseFields: fields,
      baseLitter: litterChoice,
      fields,
      litter: litterChoice,
      saved: false,
    }
  }

  const edit = action((patch: Partial<CatProfileFields>) => {
    const entry = startEdit()
    if (entry === null) return
    saveFailed.set(false)
    edits.set({ ...entry, fields: { ...entry.fields, ...patch } })
  }, `${name}.edit`)

  const chooseLitter = action((choice: LitterChoice) => {
    const entry = startEdit()
    if (entry === null) return
    saveFailed.set(false)
    edits.set({ ...entry, litter: choice })
  }, `${name}.chooseLitter`)

  const reset = action(() => {
    saveFailed.set(false)
    edits.set(null)
  }, `${name}.reset`)

  const save = action(async (): Promise<ModuleApiError | void> => {
    const target = cat()
    const entry = edits()
    const fields = draft()
    const current = live()
    if (target === null || fields === null || current === null) return
    const parsed = CatProfileFieldsSchema.safeParse(fields)
    if (!parsed.success) return
    // A litter the user did not change is the one the profile has now, never a stale copy: a
    // "Новый лоток" already sent must not travel again and create a second litter.
    const sentFrom = current.profile
    const choice: LitterChoice =
      entry !== null && !sameLitter(entry.litter, entry.baseLitter)
        ? entry.litter
        : { kind: 'existing', litterId: sentFrom.litterId }
    saveFailed.set(false)

    const result = await wrap(target.saveProfile(parsed.data, choice))
    if (result instanceof Error) {
      saveFailed.set(true)
      return result
    }

    const now = edits()
    const after = live()
    if (now === null || after === null) return
    if (now !== entry) {
      // Typed on while it was saving: those edits stay, but a sent "Новый лоток" is done with.
      if (choice.kind === 'new' && now.litter.kind === 'new') {
        const untouched: LitterChoice = { kind: 'existing', litterId: after.profile.litterId }
        edits.set({ ...now, litter: untouched, baseLitter: untouched })
      }
      return
    }
    // The answer is in already, or the new litter's id is only known from it: the profile shows.
    if (choice.kind === 'new' || after.profile !== sentFrom) {
      edits.set(null)
      return
    }
    // Otherwise the sent values stay on screen until the profile key answers.
    edits.set({
      ...now,
      source: sentFrom,
      fields: parsed.data,
      baseFields: parsed.data,
      litter: choice,
      baseLitter: choice,
      saved: true,
    })
  }, `${name}.save`).extend(withAsync())

  const saving = computed(() => !save.ready(), `${name}.saving`)

  const offered = makeLitterOptions(model, `${name}.offeredLitters`)
  const litterOptions = computed((): ProfileLitterOption[] | null => {
    const cats = model()
    const list = offered()
    if (cats === null || list === null) return null
    return [
      ...list.map(
        (option): ProfileLitterOption => ({
          value: option.id,
          choice: { kind: 'existing', litterId: option.id },
          title: option.title,
          note: cats.litter(option.id).settings()?.rotation.join(' и ') ?? null,
          cats: option.cats,
        }),
      ),
      {
        value: NEW_LITTER_VALUE,
        choice: { kind: 'new' },
        title: 'Новый лоток',
        note: 'своя очередь',
        cats: [],
      },
    ]
  }, `${name}.litterOptions`)

  return {
    draft,
    litter,
    dirty,
    issues,
    saving,
    saveFailed,
    litterOptions,
    edit,
    chooseLitter,
    reset,
    save,
  }
}
