/**
 * Standard Russian plural-form selection (one/few/many) by count, e.g. 1 устройство,
 * 2 устройства, 5 устройств.
 */
export function pluralize(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

const GENITIVE_NUMERALS = [
  'одного',
  'двух',
  'трёх',
  'четырёх',
  'пяти',
  'шести',
  'семи',
  'восьми',
  'девяти',
  'десяти',
  'одиннадцати',
  'двенадцати',
  'тринадцати',
  'четырнадцати',
  'пятнадцати',
  'шестнадцати',
  'семнадцати',
  'восемнадцати',
  'девятнадцати',
  'двадцати',
] as const

/** Genitive numeral word for 1–20 ("до восьми профилей"); digits beyond that. */
export function formatGenitiveNumeral(count: number): string {
  return GENITIVE_NUMERALS[count - 1] ?? String(count)
}
