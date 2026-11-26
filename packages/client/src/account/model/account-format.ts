// Display helpers shared by the account menu, the profile and devices dialogs, and the crop
// dialog's previews.

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

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0] + parts[1]![0]).toUpperCase()
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

const MONTHS_GENITIVE = [
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
]

/**
 * "12 июня 2026", in local time. Spelled out by hand rather than through Intl, whose ru-RU long
 * date appends " г." and varies with the ICU build.
 */
export function formatLongDate(epochMs: number): string {
  const date = new Date(epochMs)
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`
}
