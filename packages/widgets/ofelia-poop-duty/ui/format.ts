import { MONTHS_GENITIVE, pluralRu } from '@shared/format/ru'

import type { DebtBalanceEntry, SelectedDayView } from './view-model'

export function pluralizeDays(n: number): string {
  return `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`
}

export function pluralizeRecords(n: number): string {
  return `${n} ${pluralRu(n, 'запись', 'записи', 'записей')}`
}

export function formatWeekRange(days: { iso: string }[]): string {
  if (days.length === 0) return ''

  const start = Temporal.PlainDate.from(days[0].iso)
  const end = Temporal.PlainDate.from(days[days.length - 1].iso)

  if (start.month === end.month) {
    return `${start.day}–${end.day} ${MONTHS_GENITIVE[end.month - 1]}`
  }

  return `${start.day} ${MONTHS_GENITIVE[start.month - 1]} – ${end.day} ${MONTHS_GENITIVE[end.month - 1]}`
}

export function selectedDaySubtitle(
  selected: SelectedDayView,
  balance: DebtBalanceEntry[],
): string {
  if (selected.isDebtDay) {
    const lead = selected.status === 'closed' ? 'долг сокращён' : 'гасит долг'
    return `${lead} · ${pluralizeDays(selected.debtRemaining)}`
  }

  const noDebt = balance.every((entry) => entry.debt === 0)
  return noDebt ? 'по очереди · долгов нет' : 'по очереди'
}
