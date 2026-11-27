import { formatGenitiveNumeral, pluralize } from '@shared/format/ru-count'
import { SCALE_USER_SLOTS } from '@shared/hardware/spike-assumptions'
import type { Profile } from 'module-health/domain/profile'

// Radio policy, not a spike value.
export const SIGNAL_GOOD_DBM = -70
export const SIGNAL_FAIR_DBM = -85

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS

// ru-RU in the viewer's local time zone, same choices as widgets/weight/model/format.ts.
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function startOfLocalDay(at: number): number {
  const d = new Date(at)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** `только что` / `N мин назад` / `N ч назад` / `24 нояб.` */
export function formatAgo(at: number, now: number): string {
  const elapsed = now - at
  if (elapsed < MINUTE_MS) return 'только что'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} мин назад`
  if (elapsed < 24 * HOUR_MS) return `${Math.floor(elapsed / HOUR_MS)} ч назад`
  return dayFormat.format(at)
}

/** `взвешивание сегодня, 08:12` / `… вчера, 21:40` / `… 24 нояб., 07:58` / `взвешиваний ещё не было` */
export function formatLastReading(at: number | null, now: number): string {
  if (at === null) return 'взвешиваний ещё не было'
  const dayDiff = Math.round((startOfLocalDay(now) - startOfLocalDay(at)) / (24 * HOUR_MS))
  const time = timeFormat.format(at)
  if (dayDiff === 0) return `взвешивание сегодня, ${time}`
  if (dayDiff === 1) return `взвешивание вчера, ${time}`
  return `взвешивание ${dayFormat.format(at)}, ${time}`
}

/** `батарея 80%` */
export function formatBattery(percent: number): string {
  return `батарея ${percent}%`
}

export function formatSignal(rssi: number): string {
  if (rssi >= SIGNAL_GOOD_DBM) return 'сигнал хороший'
  if (rssi >= SIGNAL_FAIR_DBM) return 'сигнал средний'
  return 'сигнал слабый'
}

/** A calendar day; `Temporal.PlainDate` fits, and so does `localCalendarDay`'s plain object. */
export type CalendarDay = { year: number; month: number; day: number }

/** The viewer's local calendar day at `at` (month 1–12), without needing `Temporal` at runtime. */
export function localCalendarDay(at: number): CalendarDay {
  const d = new Date(at)
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
}

/** `34 года`: whole years from an ISO `YYYY-MM-DD` birth date to `today`. */
export function formatAge(birthDate: string, today: CalendarDay): string {
  const [year = 0, month = 0, day = 0] = birthDate.split('-').map(Number)
  const hadBirthday = today.month > month || (today.month === month && today.day >= day)
  const years = today.year - year - (hadBirthday ? 0 : 1)
  return `${years} ${pluralize(years, 'год', 'года', 'лет')}`
}

const SEX_LABELS: Record<Profile['sex'], string> = { male: 'мужской', female: 'женский' }

/** `рост 182 см · 34 года · мужской` */
export function formatScaleProfileSummary(profile: Profile, today: CalendarDay): string {
  return `рост ${profile.heightCm} см · ${formatAge(profile.birthDate, today)} · ${SEX_LABELS[profile.sex]}`
}

/** `До восьми профилей` */
export function formatSlotsUpTo(): string {
  const n = SCALE_USER_SLOTS
  return `До ${formatGenitiveNumeral(n)} ${pluralize(n, 'профиля', 'профилей', 'профилей')}`
}

/** `на весах заняты все 8 профилей` */
export function formatSlotsFull(): string {
  const n = SCALE_USER_SLOTS
  return `на весах заняты все ${n} ${pluralize(n, 'профиль', 'профиля', 'профилей')}`
}
