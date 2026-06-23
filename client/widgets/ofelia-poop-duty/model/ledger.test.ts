import { describe, expect, it } from 'vitest'

import { foldDebt, resolveDays } from './ofelia-duty'
import type { LedgerEntry } from './ofelia-duty'

let seq = 0
const le = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`,
  ts: seq,
  ip: '127.0.0.1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  by: 'Леша',
  ...o,
})

describe('foldDebt', () => {
  it('is zero for an empty ledger', () => {
    expect(foldDebt([])).toEqual({ Леша: 0, Карина: 0 })
  })

  it('a plain cleaned day changes nothing', () => {
    expect(foldDebt([le({ date: '2026-06-16', type: 'cleaned', actor: 'Леша' })])).toEqual({
      Леша: 0,
      Карина: 0,
    })
  })

  it('went_into_debt adds one to the scheduled person (onBehalfOf)', () => {
    expect(
      foldDebt([le({ type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' })]),
    ).toEqual({ Леша: 1, Карина: 0 })
  })

  it('cleaning a debt day (cleaned + onBehalfOf) repays the cleaner', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-17', type: 'cleaned', actor: 'Леша', onBehalfOf: 'Карина' }),
    ]
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })

  it('forgiven subtracts one from the debtor (onBehalfOf)', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' }),
    ]
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })

  it('latest entry per date wins for day outcomes (reset reverses the day)', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'reset', actor: 'Леша' }),
    ]
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })

  it('forgiven is independent of per-date dedup and stacks', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-14', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 3, date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' }),
    ]
    // two debts incurred, one forgiven → net 1
    expect(foldDebt(entries)).toEqual({ Леша: 1, Карина: 0 })
  })

  it('nets two-sided debt down via normalizeDebts', () => {
    const entries = [
      le({ ts: 1, date: '2026-06-15', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
      le({ ts: 2, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
    ]
    // each owes one → nets to zero
    expect(foldDebt(entries)).toEqual({ Леша: 0, Карина: 0 })
  })
})

describe('resolveDays', () => {
  it('marks a cleaned day closed with its actor', () => {
    const map = resolveDays([le({ date: '2026-06-16', type: 'cleaned', actor: 'Леша' })])
    expect(map.get('2026-06-16')).toMatchObject({ status: 'closed', type: 'cleaned', actor: 'Леша' })
  })

  it('marks a went_into_debt day closed and carries onBehalfOf', () => {
    const map = resolveDays([
      le({ date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
    ])
    expect(map.get('2026-06-16')).toMatchObject({ status: 'closed', onBehalfOf: 'Леша' })
  })

  it('re-opens a day when the latest outcome is reset', () => {
    const map = resolveDays([
      le({ ts: 1, date: '2026-06-16', type: 'cleaned', actor: 'Леша' }),
      le({ ts: 2, date: '2026-06-16', type: 'reset', actor: 'Леша' }),
    ])
    expect(map.get('2026-06-16')?.status).toBe('pending')
  })

  it('takes the latest by ts and keeps dates independent', () => {
    const map = resolveDays([
      le({ ts: 2, date: '2026-06-16', type: 'cleaned', actor: 'Леша' }),
      le({ ts: 1, date: '2026-06-16', type: 'went_into_debt', actor: 'Карина', onBehalfOf: 'Леша' }),
      le({ ts: 1, date: '2026-06-17', type: 'cleaned', actor: 'Карина' }),
    ])
    expect(map.get('2026-06-16')?.type).toBe('cleaned')
    expect(map.get('2026-06-17')?.actor).toBe('Карина')
    expect(map.size).toBe(2)
  })

  it('ignores forgiven entries (not a day outcome)', () => {
    const map = resolveDays([le({ date: '2026-06-16', type: 'forgiven', actor: 'Карина', onBehalfOf: 'Леша' })])
    expect(map.has('2026-06-16')).toBe(false)
  })
})