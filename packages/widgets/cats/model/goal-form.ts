import { action, atom, computed, withAsync, withComputed, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { CatModel, GoalHint } from 'module-cats'
import { goalEntryOn } from 'module-cats/domain/cat'
import { suggestGoal } from 'module-cats/domain/goal-hint'
import type { ModuleApiError } from 'widget-runtime'

/** The message under "Своя цель" while it holds something that is not a goal. */
export const GOAL_INPUT_ERROR = 'От 50 до 1000 ккал'

/** A goal and the first day it is in force. */
export type GoalInForce = { kcal: number; since: Temporal.PlainDate }

const KCAL_PATTERN = /^\d+$/

/** A typed daily goal: a whole number of kcal, 50 to 1000 (the bounds of `GoalEntrySchema`). */
export function parseKcal(text: string): number | null {
  const trimmed = text.trim()
  if (!KCAL_PATTERN.test(trimmed)) return null
  const kcal = Number(trimmed)
  return kcal >= 50 && kcal <= 1000 ? kcal : null
}

export type GoalForm = ReturnType<typeof makeGoalForm>

/**
 * The "Суточная цель" box: the goal in force today, the one before it, the weight hint, and the
 * two ways to set a new goal from today ("Взять" the hint, or "Своя цель"). Saved on its own,
 * apart from the profile.
 */
export function makeGoalForm(
  cat: AtomLike<CatModel | null>,
  today: AtomLike<Temporal.PlainDate | null>,
  name = 'goalForm',
) {
  const current = computed((): GoalInForce | null => {
    const goals = cat()?.goals() ?? null
    const day = today()
    if (goals === null || day === null) return null
    const entry = goalEntryOn(goals, day)
    return entry === null ? null : { kcal: entry.kcal, since: Temporal.PlainDate.from(entry.since) }
  }, `${name}.current`)

  /** The goal in force the day before the current one started. */
  const previous = computed((): GoalInForce | null => {
    const goals = cat()?.goals() ?? null
    const now = current()
    if (goals === null || now === null) return null
    const entry = goalEntryOn(goals, now.since.subtract({ days: 1 }))
    return entry === null ? null : { kcal: entry.kcal, since: Temporal.PlainDate.from(entry.since) }
  }, `${name}.previous`)

  /** null while the profile, the weighings or the clock load. */
  const hint = computed((): GoalHint | null => {
    const model = cat()
    const profile = model?.profile() ?? null
    const weighings = model?.weighings() ?? null
    const day = today()
    if (model === null || profile === null || weighings === null || day === null) return null
    return suggestGoal({ profile, latest: model.latestWeighing(), today: day })
  }, `${name}.hint`)

  // A number, so a re-read of the same goal (a new object) does not count as a change below.
  const currentKcal = computed(() => current()?.kcal ?? null, `${name}.currentKcal`)

  // Shows the goal in force, and again whenever it changes; typing in between is kept.
  const text = atom('', `${name}.text`).extend(
    withComputed(() => {
      const kcal = currentKcal()
      return kcal === null ? '' : String(kcal)
    }),
  )

  /** The text a save found no goal in, so an empty input shows the error too. */
  const rejectedText = atom<string | null>(null, `${name}.rejectedText`)
  const saveFailed = atom(false, `${name}.saveFailed`)

  // A number under 50 may be one still being typed ("1", "18" on the way to "180"), so it is an
  // error only once a save found it; anything that typing more digits cannot fix is one at once.
  const error = computed(() => {
    const typed = text()
    const trimmed = typed.trim()
    if (parseKcal(typed) !== null) return null
    if (rejectedText() === typed) return GOAL_INPUT_ERROR
    if (trimmed === '') return null
    return KCAL_PATTERN.test(trimmed) && Number(trimmed) < 50 ? null : GOAL_INPUT_ERROR
  }, `${name}.error`)

  const setGoal = async (kcal: number): Promise<ModuleApiError | void> => {
    const model = cat()
    const day = today()
    if (model === null || day === null) return
    saveFailed.set(false)
    const result = await wrap(model.setGoal(kcal, day))
    if (result instanceof Error) {
      saveFailed.set(true)
      return result
    }
  }

  /** Sets "Своя цель" from today. */
  const save = action(async (): Promise<ModuleApiError | void> => {
    const typed = text()
    const kcal = parseKcal(typed)
    if (kcal === null) {
      rejectedText.set(typed)
      return
    }
    rejectedText.set(null)
    return await wrap(setGoal(kcal))
  }, `${name}.save`).extend(withAsync())

  /** "Взять": the weight hint becomes the goal from today. */
  const take = action(async (): Promise<ModuleApiError | void> => {
    const suggestion = hint()
    if (suggestion === null || suggestion.kind !== 'available') return
    return await wrap(setGoal(suggestion.kcal))
  }, `${name}.take`).extend(withAsync())

  const saving = computed(() => !save.ready() || !take.ready(), `${name}.saving`)

  return { current, previous, hint, text, error, saveFailed, saving, save, take }
}
