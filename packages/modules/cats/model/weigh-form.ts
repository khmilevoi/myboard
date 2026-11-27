import { action, atom, computed, withAsync, withComputed, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { ModuleApiError } from 'widget-runtime'

import { CalendarDateSchema } from '../domain/roster'
import type { CatModel } from './cat-model'

/** The message under the kg input while it holds something that is not a weight. */
export const WEIGHT_INPUT_ERROR = 'Введите вес от 0,01 до 30 кг'
/** The message after `weigh` returned an error; the typed weight stays for a retry. */
export const WEIGHT_SAVE_ERROR = 'Не удалось сохранить вес'

const KG_PATTERN = /^\d+(?:[.,]\d{1,2})?$/

/**
 * A typed weight in kg: trimmed, one `,` or `.` as the decimal separator, at most two decimals,
 * and `0 < kg <= 30` (the bounds of `WeighingSchema`). null for anything else.
 */
export function parseKg(text: string): number | null {
  const trimmed = text.trim()
  if (!KG_PATTERN.test(trimmed)) return null
  const kg = Number(trimmed.replace(',', '.'))
  if (kg <= 0 || kg > 30) return null
  return kg
}

/** A date input's value (`YYYY-MM-DD`, or '' once cleared) as a date; null unless it is a real day. */
export function parseDateInput(value: string): Temporal.PlainDate | null {
  return CalendarDateSchema.safeParse(value).success ? Temporal.PlainDate.from(value) : null
}

/** The latest weighing, and the change the typed weight would make to it (null until it parses). */
export type WeighPrevious = { kg: number; at: Temporal.PlainDate; deltaGrams: number | null }

export type WeighForm = ReturnType<typeof makeWeighForm>

/**
 * The "Вес" form: one weight on one date for one cat. Shared by the "Кошки" widget and the food
 * widget. `date` follows `today` until the user picks another day, and goes back to it on reset.
 */
export function makeWeighForm(
  cat: AtomLike<CatModel | null>,
  today: AtomLike<Temporal.PlainDate | null>,
  name = 'weighForm',
) {
  const text = atom('', `${name}.text`)
  const date = atom<Temporal.PlainDate | null>(null, `${name}.date`).extend(
    withComputed(() => today()),
  )
  /**
   * The text a submit found no weight in, so an empty input shows the error too. Keyed by the text
   * rather than a flag, so editing the input forgets it without a reset.
   */
  const rejectedText = atom<string | null>(null, `${name}.rejectedText`)
  /** The text whose `weigh` failed; editing the weight clears the message the same way. */
  const failedText = atom<string | null>(null, `${name}.failedText`)

  const kg = computed(() => parseKg(text()), `${name}.kg`)

  const error = computed(() => {
    if (kg() !== null) return null
    return text().trim() !== '' || rejectedText() === text() ? WEIGHT_INPUT_ERROR : null
  }, `${name}.error`)

  const failure = computed(
    () => (failedText() === text() ? WEIGHT_SAVE_ERROR : null),
    `${name}.failure`,
  )

  /** Whether `submit` would send now: a weight, a date and the cat are all there. */
  const canSend = computed(
    () => kg() !== null && date() !== null && cat() !== null,
    `${name}.canSend`,
  )

  const previous = computed((): WeighPrevious | null => {
    const latest = cat()?.latestWeighing() ?? null
    if (latest === null) return null
    const typed = kg()
    return {
      kg: latest.kg,
      at: Temporal.PlainDate.from(latest.at),
      deltaGrams: typed === null ? null : Math.round((typed - latest.kg) * 1000),
    }
  }, `${name}.previous`)

  const submit = action(async (): Promise<ModuleApiError | void> => {
    const model = cat()
    const weight = kg()
    const day = date()
    if (weight === null) {
      rejectedText.set(text())
      return
    }
    if (model === null || day === null) return

    const result = await wrap(model.weigh(weight, day))
    if (result instanceof Error) {
      failedText.set(text())
      return result
    }

    text.set('')
    rejectedText.set(null)
    failedText.set(null)
    date.set(today())
  }, `${name}.submit`).extend(withAsync())

  return { text, date, kg, canSend, error, failure, previous, submit }
}
