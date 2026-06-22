import type { DebtBalanceEntry, SelectedDayView } from './view-model'

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
] as const

export function pluralizeDays(n: number): string {
  const abs = Math.abs(n) % 100
  const last = abs % 10

  let word: string
  if (abs >= 11 && abs <= 14) word = 'дней'
  else if (last === 1) word = 'день'
  else if (last >= 2 && last <= 4) word = 'дня'
  else word = 'дней'

  return `${n} ${word}`
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
    return `${lead} · осталось ${pluralizeDays(selected.debtRemaining)}`
  }

  const noDebt = balance.every((entry) => entry.debt === 0)
  return noDebt ? 'по очереди · долгов нет' : 'по очереди'
}
