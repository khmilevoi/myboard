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

/** The sex a name is declined by. */
export type NameSex = 'female' | 'male'

const HISSING = new Set(['ж', 'ч', 'ш', 'щ', 'ц'])
const VOWELS = new Set(['а', 'е', 'ё', 'и', 'о', 'у', 'ы', 'э', 'ю', 'я'])

/**
 * The gender a name is declined by: the given sex, or, without one, the gender its ending implies —
 * a consonant or "-й" is masculine, "-а", "-я" and "-ь" feminine.
 */
export function nameGender(name: string, sex: NameSex | null): NameSex {
  if (sex !== null) return sex
  const last = name.toLowerCase().slice(-1)
  if (last === 'й') return 'male'
  if (/[а-яё]/.test(last) && !VOWELS.has(last) && last !== 'ь') return 'male'
  return 'female'
}

/**
 * A masculine consonant stem with its fleeting vowel dropped ("Огурец" → "Огурц", "Пушок" →
 * "Пушк", "Уголёк" → "Угольк"), or the name as it is.
 */
function masculineStem(name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('ец')) return `${name.slice(0, -2)}ц`
  if (lower.endsWith('ёк')) return `${name.slice(0, -2)}ьк`
  if (lower.endsWith('ок')) return `${name.slice(0, -2)}к`
  return name
}

/**
 * A name in the accusative case, for "Убрать Бусю в архив?": "-а" → "-у", "-я" → "-ю"; a male
 * consonant, "-й" or "-ь" name declines like an animate noun ("Барсика", "Тимофея", "Игоря"). A
 * feminine "-ь" or consonant name, a vowel ending and a foreign name stay as they are.
 */
export function accusative(name: string, sex: NameSex | null): string {
  const lower = name.toLowerCase()
  const last = lower.slice(-1)
  const stem = name.slice(0, -1)
  if (!/[а-яё]$/.test(lower)) return name
  if (last === 'а') return `${stem}у`
  if (last === 'я') return `${stem}ю`
  if (nameGender(name, sex) === 'female') return name
  if (last === 'й' || last === 'ь') return `${stem}я`
  if (VOWELS.has(last)) return name
  return `${masculineStem(name)}а`
}

/**
 * A name in the instrumental case, for "Общий с Офелией": "-а" → "-ой" ("-ей" after a hissing
 * consonant), "-я" → "-ей", a feminine "-ь" → "-ью", a masculine "-ь" or "-й" → "-ем", a male
 * consonant → "-ом" ("-ем" after a hissing one, but "Огурцом"). A feminine consonant name, a vowel ending and a
 * foreign name stay as they are.
 */
export function instrumental(name: string, sex: NameSex | null): string {
  const lower = name.toLowerCase()
  const last = lower.slice(-1)
  const stem = name.slice(0, -1)
  const female = nameGender(name, sex) === 'female'
  if (!/[а-яё]$/.test(lower)) return name
  if (last === 'я') return `${stem}ей`
  if (last === 'а') return `${stem}${HISSING.has(lower.slice(-2, -1)) ? 'ей' : 'ой'}`
  if (last === 'ь') return female ? `${name}ю` : `${stem}ем`
  if (female) return name
  if (last === 'й') return `${stem}ем`
  if (VOWELS.has(last)) return name
  // The "-ец" names a cat gets ("Огурец", "Боец") are stressed on the ending: "Огурцом".
  if (lower.endsWith('ец')) return `${masculineStem(name)}ом`
  return `${masculineStem(name)}${HISSING.has(last) ? 'ем' : 'ом'}`
}
