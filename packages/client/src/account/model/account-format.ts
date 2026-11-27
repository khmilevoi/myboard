import { MONTHS_GENITIVE } from '@shared/format/ru'

// Display helpers shared by the account menu, the profile and devices dialogs, and the crop
// dialog's previews. Plurals and month names come from `@shared/format/ru`.

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0] + parts[1]![0]).toUpperCase()
}

export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? ''
}

/**
 * "12 июня 2026", in local time. Spelled out by hand rather than through Intl, whose ru-RU long
 * date appends " г." and varies with the ICU build.
 */
export function formatLongDate(epochMs: number): string {
  const date = new Date(epochMs)
  return `${date.getDate()} ${MONTHS_GENITIVE[date.getMonth()]} ${date.getFullYear()}`
}
