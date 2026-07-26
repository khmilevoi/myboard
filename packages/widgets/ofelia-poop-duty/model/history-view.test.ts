// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { LedgerEntry } from '@/domain/ledger'

import { toHistoryGroups } from './history-view'

const KARINA = { accountId: 'a1', name: 'Карина' }
const members = new Map([['a1', { accountId: 'a1', name: 'Карина' }]])

const entry = (o: Partial<LedgerEntry> & Pick<LedgerEntry, 'id' | 'ts'>): LedgerEntry => ({
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  ...o,
})

// 2026-06-16 22:00 Europe/Warsaw
const ON_TIME = Date.UTC(2026, 5, 16, 20, 0, 0)
// 2026-06-18 22:00 Europe/Warsaw
const LATE = Date.UTC(2026, 5, 18, 20, 0, 0)

const call = (entries: LedgerEntry[]) =>
  toHistoryGroups({ entries, weekStartIso: '2026-06-15', members, viewerAccountId: 'a1' })

describe('toHistoryGroups', () => {
  it('puts the newest entry of a day in `current` and the rest in `superseded`', () => {
    const groups = call([
      entry({ id: 'old', ts: 1, type: 'cleaned', actor: 'Леша' }),
      entry({ id: 'mid', ts: 2, type: 'reset', actor: 'Леша' }),
      entry({ id: 'new', ts: 3, type: 'cleaned', actor: 'Карина' }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].current.id).toBe('new')
    expect(groups[0].superseded.map((view) => view.id)).toEqual(['mid', 'old'])
  })

  it('keeps `superseded` newest first when every record shares a ts', () => {
    const groups = call([
      entry({ id: 'old', ts: 7, type: 'cleaned', actor: 'Леша' }),
      entry({ id: 'mid', ts: 7, type: 'reset', actor: 'Леша' }),
      entry({ id: 'new', ts: 7, type: 'cleaned', actor: 'Карина' }),
    ])

    expect(groups[0].current.id).toBe('new')
    expect(groups[0].superseded.map((view) => view.id)).toEqual(['mid', 'old'])
  })

  it('orders groups newest duty day first', () => {
    const groups = call([
      entry({ id: 'a', ts: 1, date: '2026-06-16' }),
      entry({ id: 'b', ts: 2, date: '2026-06-18' }),
    ])

    expect(groups.map((group) => group.dutyDate)).toEqual(['2026-06-18', '2026-06-16'])
  })

  it('drops entries outside the viewed week', () => {
    expect(call([entry({ id: 'a', ts: 1, date: '2026-06-08' })])).toEqual([])
  })

  it('computes the debt delta per type', () => {
    const [plain, onBehalf, debt, forgiven] = [
      call([entry({ id: '1', ts: 1 })])[0].current,
      call([entry({ id: '2', ts: 1, actor: 'Карина', onBehalfOf: 'Леша' })])[0].current,
      call([
        entry({ id: '3', ts: 1, type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
      ])[0].current,
      call([entry({ id: '4', ts: 1, type: 'forgiven', actor: 'Леша', onBehalfOf: 'Карина' })])[0]
        .current,
    ]

    expect(plain.debtDelta).toBeNull()
    expect(onBehalf.debtDelta).toEqual({ person: 'Карина', amount: -1 })
    expect(debt.debtDelta).toEqual({ person: 'Карина', amount: 1 })
    expect(forgiven.debtDelta).toEqual({ person: 'Карина', amount: -1 })
  })

  it('flags a record written on a different calendar day than the duty day', () => {
    const onTime = call([entry({ id: '1', ts: ON_TIME })])[0].current
    const late = call([entry({ id: '2', ts: LATE })])[0].current

    expect(onTime.recordedLate).toBe(false)
    expect(late.recordedLate).toBe(true)
  })

  it('resolves the author and marks the viewer', () => {
    const mine = call([entry({ id: '1', ts: 1, createdBy: KARINA })])[0].current
    const theirs = call([
      entry({ id: '2', ts: 1, createdBy: { accountId: 'a2', name: 'Лёша' } }),
    ])[0].current
    const legacy = call([entry({ id: '3', ts: 1, by: 'Леша' })])[0].current

    expect(mine.recordedBy).toMatchObject({ kind: 'account', name: 'Карина' })
    expect(mine.isViewerRecord).toBe(true)
    expect(theirs.isViewerRecord).toBe(false)
    expect(legacy.recordedBy).toEqual({ kind: 'person', person: 'Леша' })
  })
})
