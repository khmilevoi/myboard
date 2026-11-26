import type { WeightPeriod } from './weight-view'

// ru-RU in the viewer's local time zone: "today" and the clock are their local calendar.
const kgFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
  useGrouping: false,
})
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

// A true minus sign, as the design writes it; Intl's ru-RU minus is a hyphen.
const MINUS = '−'

export const PERIOD_LABELS: Record<WeightPeriod, string> = {
  '30d': '30 дней',
  '90d': '90 дней',
  '1y': 'Год',
}

export const PERIOD_SUFFIXES: Record<WeightPeriod, string> = {
  '30d': 'за 30 дней',
  '90d': 'за 90 дней',
  '1y': 'за год',
}

/** The number alone, `83,0`, for layouts that set the unit apart. */
export function formatKgValue(value: number): string {
  return kgFormat.format(value)
}

/** `83,0 кг` */
export function formatKg(value: number): string {
  return `${formatKgValue(value)} кг`
}

/**
 * `−1,2` / `+0,4` / `0,0`. Rounded to one decimal before the sign is chosen, so a change that
 * rounds to zero is never printed as `−0,0` or `+0,0`.
 */
export function formatChange(value: number): string {
  const tenths = Math.round(Math.abs(value) * 10)
  const digits = kgFormat.format(tenths / 10)
  if (tenths === 0) return digits
  return `${value < 0 ? MINUS : '+'}${digits}`
}

/** `−1,2 кг` / `+0,4 кг` / `0,0 кг` */
export function formatDelta(value: number): string {
  return `${formatChange(value)} кг`
}

function isSameLocalDay(a: number, b: number): boolean {
  const x = new Date(a)
  const y = new Date(b)
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  )
}

/** `сегодня` / `24 нояб.` */
export function formatTakenOn(takenAt: number, now: number): string {
  if (isSameLocalDay(takenAt, now)) return 'сегодня'
  return dayFormat.format(takenAt)
}

/** `сегодня, 08:12` for today, otherwise the date alone: `24 нояб.` */
export function formatTakenAt(takenAt: number, now: number): string {
  if (isSameLocalDay(takenAt, now)) return `сегодня, ${timeFormat.format(takenAt)}`
  return dayFormat.format(takenAt)
}

/** `сегодня, 08:12` / `24 нояб., 07:58` — a measurement list row. */
export function formatTakenAtFull(takenAt: number, now: number): string {
  return `${formatTakenOn(takenAt, now)}, ${timeFormat.format(takenAt)}`
}

/** `сегодня` / `24 нояб` — a chart axis label, without the abbreviation dot. */
export function formatTick(takenAt: number, now: number): string {
  return formatTakenOn(takenAt, now).replace(/\.$/, '')
}
