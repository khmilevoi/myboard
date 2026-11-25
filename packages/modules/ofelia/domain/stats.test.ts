import { describe, expect, it } from 'vitest'

import { foldDebt } from './debt'
import type { LedgerEntry } from './ledger'
import type { Person } from './roster'
import { STATS_WINDOW_DAYS, memberStats } from './stats'

let nextTs = 1
const entry = (
  type: LedgerEntry['type'],
  date: string,
  actor: Person,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry => {
  const ts = nextTs++
  return { id: `e${ts}`, ts, date, type, actor, ...extra }
}
const cleaned = (date: string, actor: Person) => entry('cleaned', date, actor)
const reset = (date: string, actor: Person) => entry('reset', date, actor)
const wentIntoDebt = (date: string, actor: Person) =>
  entry('went_into_debt', date, actor, { onBehalfOf: actor })

describe('memberStats', () => {
  it('uses a 30-day window by default', () => {
    expect(STATS_WINDOW_DAYS).toBe(30)
  })

  // today 2026-06-30, so the 30-day window starts at 2026-06-01
  it('counts cleaned days per actor inside the window and reports current debt', () => {
    const entries = [
      cleaned('2026-06-30', 'Леша'),
      cleaned('2026-06-01', 'Леша'),
      cleaned('2026-05-31', 'Леша'),
      cleaned('2026-06-15', 'Карина'),
      reset('2026-06-15', 'Карина'),
      wentIntoDebt('2026-06-20', 'Карина'),
    ]
    expect(
      memberStats({ entries, today: Temporal.PlainDate.from('2026-06-30'), windowDays: 30 }),
    ).toEqual([
      { person: 'Леша', cleanings: 2, debt: foldDebt(entries)['Леша'] ?? 0 },
      { person: 'Карина', cleanings: 0, debt: foldDebt(entries)['Карина'] ?? 0 },
    ])
  })

  it('returns a zero row for every rotation member on an empty ledger', () => {
    expect(
      memberStats({ entries: [], today: Temporal.PlainDate.from('2026-06-30'), windowDays: 30 }),
    ).toEqual([
      { person: 'Леша', cleanings: 0, debt: 0 },
      { person: 'Карина', cleanings: 0, debt: 0 },
    ])
  })
})
