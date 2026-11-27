// Russian display text for the cat widgets. Pure and DOM-free; the module's server bundle never
// imports it (it is not under domain/).
import { MONTHS_GENITIVE, formatDecimalRu, pluralRu } from '@shared/format/ru'

import type { CatProfile } from './domain/cat'

const MINUS = '−'

/** A litter card's text while no cat, and so no litter, is offered (ruling 10). */
export const EMPTY_LITTER_TEXT = 'Лоток появится, когда в виджете «Кошки» будет кошка'

/** "4,32 кг": always two decimals, with the decimal comma. */
export function formatKg(kg: number): string {
  return `${formatDecimalRu(kg, 2)} кг`
}

/** "−80 г", "+260 г", "0 г": a signed gram change, rounded to whole grams, U+2212 for minus. */
export function formatGrams(grams: number): string {
  const rounded = Math.round(grams)
  if (rounded === 0) return '0 г'
  return `${rounded < 0 ? MINUS : '+'}${Math.abs(rounded)} г`
}

/**
 * "3 года 2 мес" (`long`), "3 года" (`short`), "8 мес" (under a year, either form). Whole months
 * only, counted down; null for a birth date after `today`.
 */
export function formatAge(
  birth: Temporal.PlainDate,
  today: Temporal.PlainDate,
  form: 'long' | 'short',
): string | null {
  if (Temporal.PlainDate.compare(birth, today) > 0) return null
  const { years, months } = birth.until(today, { largestUnit: 'years', smallestUnit: 'months' })
  if (years === 0) return `${months} мес`
  const yearsText = `${years} ${pluralRu(years, 'год', 'года', 'лет')}`
  if (form === 'short' || months === 0) return yearsText
  return `${yearsText} ${months} мес`
}

/** "сегодня", "вчера", "2 дня назад", "21 день назад". */
export function formatDaysAgo(days: number): string {
  if (days === 0) return 'сегодня'
  if (days === 1) return 'вчера'
  return `${days} ${pluralRu(days, 'день', 'дня', 'дней')} назад`
}

/** "21 ноября". */
export function formatDayMonth(date: Temporal.PlainDate): string {
  return `${date.day} ${MONTHS_GENITIVE[date.month - 1]}`
}

/** "кошка" / "кот"; null when the sex is not set. */
export function sexLabel(sex: CatProfile['sex']): string | null {
  if (sex === 'female') return 'кошка'
  if (sex === 'male') return 'кот'
  return null
}

/** "стерилизована" / "не стерилизован", agreeing with the sex (feminine when unset); null when unknown. */
export function sterilizedLabel(
  sterilized: CatProfile['sterilized'],
  sex: CatProfile['sex'],
): string | null {
  if (sterilized === 'unknown') return null
  const word = sex === 'male' ? 'стерилизован' : 'стерилизована'
  return sterilized === 'yes' ? word : `не ${word}`
}
