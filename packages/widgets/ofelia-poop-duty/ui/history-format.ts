import { DUTY_TIME_ZONE, plainDateIn, type Person } from '@/domain/roster'
import type { HistoryEntryView } from '@/model/history-view'

import { MONTHS_GENITIVE } from './format'

const WEEKDAYS_SHORT = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const

/** A phrase is a mix of literal text and duty circles rendered inline. */
export type PhrasePart = string | { person: Person }
export type ActionPhrase = { parts: PhrasePart[] }

export function formatDayMonth(iso: string): string {
  const date = Temporal.PlainDate.from(iso)
  return `${date.day} ${MONTHS_GENITIVE[date.month - 1]}`
}

export function formatDutyDay(dutyDate: string, todayIso: string | null): string {
  if (todayIso === null) return formatDayMonth(dutyDate)
  if (dutyDate === todayIso) return 'сегодня'

  const yesterday = Temporal.PlainDate.from(todayIso).subtract({ days: 1 }).toString()
  if (dutyDate === yesterday) return 'вчера'

  return formatDayMonth(dutyDate)
}

export function formatWeekdayShort(dutyDate: string): string {
  return WEEKDAYS_SHORT[Temporal.PlainDate.from(dutyDate).dayOfWeek - 1]
}

export function formatTimeOfDay(epochMs: number): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(DUTY_TIME_ZONE)
  return `${String(zoned.hour).padStart(2, '0')}:${String(zoned.minute).padStart(2, '0')}`
}

export function formatRecordedDate(epochMs: number): string {
  return formatDayMonth(plainDateIn(DUTY_TIME_ZONE, epochMs).toString())
}

/**
 * Generic gender forms throughout: neither the roster nor an account carries a
 * gender, and adding one is explicitly out of scope.
 *
 * `reset` never names anyone: its `actor` is whose closure was undone, not who
 * undid it.
 */
export function describeEntry(entry: HistoryEntryView): ActionPhrase {
  if (entry.type === 'reset') return { parts: ['день переоткрыт'] }

  if (entry.type === 'went_into_debt' && entry.onBehalfOf) {
    return {
      parts: [{ person: entry.onBehalfOf }, ' ушёл(ла) в долг → убирает ', { person: entry.actor }],
    }
  }

  if (entry.type === 'forgiven' && entry.onBehalfOf) {
    return { parts: [{ person: entry.actor }, ' простил(а) день ', { person: entry.onBehalfOf }] }
  }

  if (entry.onBehalfOf) {
    return { parts: [{ person: entry.actor }, ' убрал(а) за ', { person: entry.onBehalfOf }] }
  }

  return { parts: [{ person: entry.actor }, ' убрал(а)'] }
}
