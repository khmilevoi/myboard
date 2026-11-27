// Russian display helpers shared by the board and every widget. Pure and DOM-free.

/**
 * Standard Russian plural-form selection by count (one / few / many): 1 день, 2 дня, 5 дней,
 * 11 дней, 21 день. A negative count takes the form of its absolute value.
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

/** "12 июня": month names in the genitive, indexed from 0 (January). */
export const MONTHS_GENITIVE = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const

/** "27 окт": short month names for dense rows and chart axes, indexed from 0 (January). */
export const MONTHS_SHORT = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
] as const

/** A fixed number of fraction digits with the Russian decimal comma: `formatDecimalRu(4.3, 2)` is "4,30". */
export function formatDecimalRu(value: number, fractionDigits: number): string {
  return value.toFixed(fractionDigits).replace('.', ',')
}
