import { describe, expect, it } from 'vitest'

import { formatWeekRange, pluralizeDays, selectedDaySubtitle } from './format'
import type { SelectedDayView } from './view-model'

describe('pluralizeDays', () => {
  it('applies Russian plural rules', () => {
    expect(pluralizeDays(0)).toBe('0 дней')
    expect(pluralizeDays(1)).toBe('1 день')
    expect(pluralizeDays(2)).toBe('2 дня')
    expect(pluralizeDays(4)).toBe('4 дня')
    expect(pluralizeDays(5)).toBe('5 дней')
    expect(pluralizeDays(11)).toBe('11 дней')
    expect(pluralizeDays(21)).toBe('21 день')
    expect(pluralizeDays(22)).toBe('22 дня')
  })
})

describe('formatWeekRange', () => {
  it('keeps a single month when start and end share it', () => {
    const days = ['2026-06-15', '2026-06-21'].map((iso) => ({ iso }))
    expect(formatWeekRange(days)).toBe('15–21 июня')
  })

  it('spells both months across a boundary', () => {
    const days = ['2026-06-29', '2026-07-05'].map((iso) => ({ iso }))
    expect(formatWeekRange(days)).toBe('29 июня – 5 июля')
  })

  it('returns empty string for an empty week', () => {
    expect(formatWeekRange([])).toBe('')
  })
})

describe('selectedDaySubtitle', () => {
  const sel = (overrides: Partial<SelectedDayView> = {}): SelectedDayView => ({
    iso: '2026-06-17',
    person: 'Карина',
    isDebtDay: false,
    status: 'pending',
    canUndo: false,
    debtRemaining: 0,
    isFuture: false,
    ...overrides,
  })

  it('describes an open debt day', () => {
    expect(selectedDaySubtitle(sel({ isDebtDay: true, debtRemaining: 2 }), [])).toBe(
      'гасит долг · осталось 2 дня',
    )
  })

  it('describes a closed debt day', () => {
    expect(
      selectedDaySubtitle(sel({ isDebtDay: true, status: 'closed', debtRemaining: 1 }), []),
    ).toBe('долг сокращён · осталось 1 день')
  })

  it('says there is no debt when the balance is flat', () => {
    expect(
      selectedDaySubtitle(sel(), [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 0, over: false },
      ]),
    ).toBe('по очереди · долгов нет')
  })

  it('says the day is the normal turn when others still owe', () => {
    expect(
      selectedDaySubtitle(sel(), [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 3, over: false },
      ]),
    ).toBe('по очереди')
  })
})
