import { atom } from '@reatom/core'
import { describe, expect, it } from 'vitest'

import type { DayResolution, Person } from '../model/ofelia-duty'
import { makeOfeliaViewModel, resolveSelected, toBalance, toWeekDays } from './view-model'
import type { DutyDay } from './view-model'

const D = (iso: string) => Temporal.PlainDate.from(iso)

// Week of 2026-06-15 (Mon) .. 2026-06-21 (Sun); "today" = Tue 2026-06-16.
function week(): DutyDay[] {
  return [
    {
      date: D('2026-06-15'),
      isToday: false,
      day: 15,
      duty: 'Леша',
      debt: null,
      resolvedActor: null,
    },
    {
      date: D('2026-06-16'),
      isToday: true,
      day: 16,
      duty: 'Карина',
      debt: null,
      resolvedActor: null,
    },
    {
      date: D('2026-06-17'),
      isToday: false,
      day: 17,
      duty: 'Леша',
      debt: 'Карина',
      resolvedActor: null,
    },
    {
      date: D('2026-06-18'),
      isToday: false,
      day: 18,
      duty: 'Карина',
      debt: null,
      resolvedActor: null,
    },
    {
      date: D('2026-06-19'),
      isToday: false,
      day: 19,
      duty: 'Леша',
      debt: null,
      resolvedActor: null,
    },
    {
      date: D('2026-06-20'),
      isToday: false,
      day: 20,
      duty: 'Карина',
      debt: null,
      resolvedActor: null,
    },
    {
      date: D('2026-06-21'),
      isToday: false,
      day: 21,
      duty: 'Леша',
      debt: null,
      resolvedActor: null,
    },
  ]
}

const closed = (
  date: string,
  o: Partial<DayResolution> = {},
): Map<string, DayResolution> =>
  new Map([[date, { status: 'closed', type: 'cleaned', actor: 'Карина', ...o }]])

describe('resolveSelected (§3.1.1 ladder + status)', () => {
  it('defaults to today when no day is selected (current week)', () => {
    const selected = resolveSelected(week(), null, new Map(), {}, D('2026-06-16'))
    expect(selected?.iso).toBe('2026-06-16')
    expect(selected?.person).toBe('Карина')
    expect(selected?.isDebtDay).toBe(false)
  })

  it('uses the explicit selection when it is in the viewed week (debt assignee wins)', () => {
    const selected = resolveSelected(week(), D('2026-06-17'), new Map(), { Карина: 1 }, D('2026-06-16'))
    expect(selected?.iso).toBe('2026-06-17')
    expect(selected?.person).toBe('Карина')
    expect(selected?.isDebtDay).toBe(true)
    expect(selected?.debtRemaining).toBe(1)
  })

  it('falls back to the first day of the week when selection is off-week and today is absent', () => {
    const offWeek = week().map((d) => ({ ...d, isToday: false }))
    expect(resolveSelected(offWeek, D('2026-07-01'), new Map(), {}, null)?.iso).toBe('2026-06-15')
  })

  it('marks the day closed and undoable when it has a closing outcome', () => {
    const selected = resolveSelected(week(), null, closed('2026-06-16'), {}, D('2026-06-16'))
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(true)
  })

  it('allows undo for any closed day, not only today', () => {
    const selected = resolveSelected(
      week(),
      D('2026-06-17'),
      closed('2026-06-17', { type: 'went_into_debt', onBehalfOf: 'Карина' }),
      {},
      D('2026-06-16'),
    )
    expect(selected?.status).toBe('closed')
    expect(selected?.canUndo).toBe(true)
  })

  it('returns null for an empty week', () => {
    expect(resolveSelected([], null, new Map(), {}, null)).toBeNull()
  })

  it('flags a selected day after today as future', () => {
    const selected = resolveSelected(week(), D('2026-06-18'), new Map(), {}, D('2026-06-16'))
    expect(selected?.isFuture).toBe(true)
  })

  it('does not flag today or past days as future', () => {
    const today = resolveSelected(week(), D('2026-06-16'), new Map(), {}, D('2026-06-16'))
    const past = resolveSelected(week(), D('2026-06-15'), new Map(), {}, D('2026-06-16'))
    expect(today?.isFuture).toBe(false)
    expect(past?.isFuture).toBe(false)
  })

  it('treats every day as non-future when today is unknown', () => {
    const selected = resolveSelected(week(), D('2026-06-21'), new Map(), {}, null)
    expect(selected?.isFuture).toBe(false)
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
    expect(days[2]).toMatchObject({
      iso: '2026-06-17',
      person: 'Карина',
      isDebtDay: true,
      isSelected: true,
    })
    expect(days.filter((d) => d.isSelected)).toHaveLength(1)
  })
})

describe('resolved actor in the strip', () => {
  it('toWeekDays shows the resolved actor when present', () => {
    const w = week().map((d) =>
      d.date.toString() === '2026-06-17' ? { ...d, resolvedActor: 'Леша' as const } : d,
    )
    const days = toWeekDays(w, null)
    expect(days.find((d) => d.iso === '2026-06-17')?.person).toBe('Леша')
  })

  it('resolveSelected prefers the resolved actor over debt/duty', () => {
    const w = week().map((d) =>
      d.date.toString() === '2026-06-17' ? { ...d, resolvedActor: 'Леша' as const } : d,
    )
    const selected = resolveSelected(w, D('2026-06-17'), new Map(), {}, D('2026-06-16'))
    expect(selected?.person).toBe('Леша')
  })
})

describe('makeOfeliaViewModel (atomic slices)', () => {
  it('exposes focused slices and keeps the balance ref stable across a selection change', () => {
    const duty = {
      currentWeek: atom<DutyDay[] | null>(week(), 'test.currentWeek'),
      selectedDate: atom<Temporal.PlainDate | null>(null, 'test.selectedDate'),
      dayResolution: atom<Map<string, DayResolution>>(new Map(), 'test.dayResolution'),
      numberOfDebts: atom<Partial<Record<Person, number>> | null>(
        { Карина: 1 },
        'test.numberOfDebts',
      ),
      today: atom<Temporal.PlainDate | null>(D('2026-06-16'), 'test.today'),
      forgivePending: atom(false, 'test.forgivePending'),
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

  it('disables canForgive while a forgive is in flight', () => {
    const forgivePending = atom(false, 'test.forgivePending')
    const duty = {
      currentWeek: atom<DutyDay[] | null>(week(), 'test.currentWeek'),
      selectedDate: atom<Temporal.PlainDate | null>(null, 'test.selectedDate'),
      dayResolution: atom<Map<string, DayResolution>>(new Map(), 'test.dayResolution'),
      numberOfDebts: atom<Partial<Record<Person, number>> | null>(
        { Карина: 1 },
        'test.numberOfDebts',
      ),
      today: atom<Temporal.PlainDate | null>(D('2026-06-16'), 'test.today'),
      forgivePending,
    }
    const view = makeOfeliaViewModel(duty)

    expect(view.canForgive()).toBe(true)
    forgivePending.set(true)
    expect(view.canForgive()).toBe(false)
  })
})
