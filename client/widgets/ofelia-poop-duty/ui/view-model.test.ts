import { atom } from '@reatom/core'
import { describe, expect, it } from 'vitest'

import type { HistoryEvent, Person } from '../model/ofelia-duty'

import { makeOfeliaViewModel, resolveSelected, toBalance, toWeekDays } from './view-model'
import type { DutyDay } from './view-model'

const D = (iso: string) => Temporal.PlainDate.from(iso)

// Week of 2026-06-15 (Mon) .. 2026-06-21 (Sun); "today" = Tue 2026-06-16.
function week(): DutyDay[] {
  return [
    { date: D('2026-06-15'), isToday: false, day: 15, duty: 'Леша', debt: null },
    { date: D('2026-06-16'), isToday: true, day: 16, duty: 'Карина', debt: null },
    { date: D('2026-06-17'), isToday: false, day: 17, duty: 'Леша', debt: 'Карина' },
    { date: D('2026-06-18'), isToday: false, day: 18, duty: 'Карина', debt: null },
    { date: D('2026-06-19'), isToday: false, day: 19, duty: 'Леша', debt: null },
    { date: D('2026-06-20'), isToday: false, day: 20, duty: 'Карина', debt: null },
    { date: D('2026-06-21'), isToday: false, day: 21, duty: 'Леша', debt: null },
  ]
}

const ev = (overrides: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: 'e1',
  ts: 1,
  ip: '127.0.0.1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Карина',
  by: 'Карина',
  ...overrides,
})

describe('resolveSelected (§3.1.1 ladder + status)', () => {
  it('defaults to today when no day is selected (current week)', () => {
    const selected = resolveSelected(week(), null, [], {})
    expect(selected?.iso).toBe('2026-06-16')
    expect(selected?.person).toBe('Карина')
    expect(selected?.isDebtDay).toBe(false)
  })

  it('uses the explicit selection when it is in the viewed week (debt assignee wins)', () => {
    const selected = resolveSelected(week(), D('2026-06-17'), [], { Карина: 1 })
    expect(selected?.iso).toBe('2026-06-17')
    expect(selected?.person).toBe('Карина')
    expect(selected?.isDebtDay).toBe(true)
    expect(selected?.debtRemaining).toBe(1)
  })

  it('falls back to the first day of the week when selection is off-week and today is absent', () => {
    const offWeek = week().map((d) => ({ ...d, isToday: false }))
    expect(resolveSelected(offWeek, D('2026-07-01'), [], {})?.iso).toBe('2026-06-15')
  })

  it('marks the day closed and undoable when today has a cleaned event', () => {
    const selected = resolveSelected(week(), null, [ev({ date: '2026-06-16' })], {})
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(true)
  })

  it('never allows undo for a non-today selected day', () => {
    const selected = resolveSelected(
      week(),
      D('2026-06-17'),
      [ev({ date: '2026-06-17', type: 'went_into_debt' })],
      {},
    )
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(false)
  })

  it('returns null for an empty week', () => {
    expect(resolveSelected([], null, [], {})).toBeNull()
  })
})

describe('toBalance', () => {
  it('builds a balance flagged over the warning threshold (>7)', () => {
    expect(toBalance({ Карина: 8, Леша: 0 })).toEqual([
      { person: 'Леша', debt: 0, over: false },
      { person: 'Карина', debt: 8, over: true },
    ])
  })
})

describe('toWeekDays', () => {
  it('maps weekday labels, debt dots, and the selected flag across the strip', () => {
    const days = toWeekDays(week(), '2026-06-17')
    expect(days.map((d) => d.weekday)).toEqual(['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'])
    expect(days[1]?.isToday).toBe(true)
    expect(days[2]).toMatchObject({ iso: '2026-06-17', isDebtDay: true, isSelected: true })
    expect(days.filter((d) => d.isSelected)).toHaveLength(1)
  })
})

describe('makeOfeliaViewModel (atomic slices)', () => {
  it('exposes focused slices and keeps the balance ref stable across a selection change', () => {
    const duty = {
      currentWeek: atom<DutyDay[] | null>(week(), 'test.currentWeek'),
      selectedDate: atom<Temporal.PlainDate | null>(null, 'test.selectedDate'),
      historyEvents: atom<HistoryEvent[]>([], 'test.historyEvents'),
      numberOfDebts: atom<Partial<Record<Person, number>> | null>({ Карина: 1 }, 'test.numberOfDebts'),
    }
    const view = makeOfeliaViewModel(duty)

    expect(view.ready()).toBe(true)
    expect(view.selected()?.iso).toBe('2026-06-16')
    expect(view.canForgive()).toBe(true)

    const balanceBefore = view.balance()
    duty.selectedDate.set(D('2026-06-17'))

    // Selection moved, but debts did not change → the `balance` computed is not
    // invalidated and returns the same reference (the atomic win we are after).
    expect(view.selected()?.iso).toBe('2026-06-17')
    expect(view.balance()).toBe(balanceBefore)
  })
})
