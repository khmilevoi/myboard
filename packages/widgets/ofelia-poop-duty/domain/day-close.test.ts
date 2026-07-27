import { describe, expect, it } from 'vitest'

import { autoApproveDrafts } from './day-close'
import { foldDebt } from './debt'
import type { LedgerEntry } from './ledger'

// 2026-06-19T00:05:00+02:00 — the cron moment that closes 2026-06-12…2026-06-18.
const SCHEDULED_FOR = Date.parse('2026-06-19T00:05:00+02:00')

function entry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: 'seed',
    ts: 1,
    date: '2026-06-18',
    type: 'cleaned',
    actor: 'Карина',
    createdBy: { accountId: 'a1', name: 'Карина' },
    ...overrides,
  }
}

describe('autoApproveDrafts', () => {
  it('closes every unresolved day of the window as cleaned by the planned duty', () => {
    const drafts = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })

    expect(drafts.map((draft) => draft.date)).toEqual([
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
      '2026-06-17',
      '2026-06-18',
    ])
    expect(drafts.every((draft) => draft.type === 'cleaned')).toBe(true)
    expect(drafts.every((draft) => draft.createdBy != null && 'system' in draft.createdBy)).toBe(
      true,
    )
    // 2026-06-16 is BASE_DUTY_DATE → Леша; the rotation alternates daily.
    expect(drafts.find((draft) => draft.date === '2026-06-16')?.actor).toBe('Леша')
    expect(drafts.find((draft) => draft.date === '2026-06-17')?.actor).toBe('Карина')
  })

  it('never touches the day the cron fires on', () => {
    const drafts = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })

    expect(drafts.some((draft) => draft.date === '2026-06-19')).toBe(false)
  })

  it('skips days that already have a closed outcome', () => {
    const drafts = autoApproveDrafts({
      entries: [entry({ date: '2026-06-18' })],
      scheduledForMs: SCHEDULED_FOR,
    })

    expect(drafts.some((draft) => draft.date === '2026-06-18')).toBe(false)
  })

  it('re-closes a day that was deliberately reset', () => {
    const drafts = autoApproveDrafts({
      entries: [entry({ date: '2026-06-18', type: 'reset', ts: 2 })],
      scheduledForMs: SCHEDULED_FOR,
    })

    expect(drafts.some((draft) => draft.date === '2026-06-18')).toBe(true)
  })

  it('is idempotent — feeding its own output back produces nothing', () => {
    const first = autoApproveDrafts({ entries: [], scheduledForMs: SCHEDULED_FOR })
    const applied: LedgerEntry[] = first.map((draft, index) => ({
      id: `auto-${index}`,
      ts: 100 + index,
      ...draft,
    }))

    expect(autoApproveDrafts({ entries: applied, scheduledForMs: SCHEDULED_FOR })).toEqual([])
  })

  it('settles an outstanding debt exactly once when the cron reaches its debt day (F1)', () => {
    // Карина owes one day (Леша cleaned 06-11 on her behalf); her debt day is
    // never manually touched — only the nightly cron ever looks at it.
    const debtEntry = entry({
      date: '2026-06-11',
      type: 'went_into_debt',
      actor: 'Леша',
      onBehalfOf: 'Карина',
      ts: 1,
    })

    const drafts = autoApproveDrafts({ entries: [debtEntry], scheduledForMs: SCHEDULED_FOR })

    // 06-12 is the first day in the window that isn't Карина's own duty day,
    // so it is where her debt gets settled.
    const settlement = drafts.find((draft) => draft.date === '2026-06-12')
    expect(settlement).toMatchObject({ actor: 'Карина', onBehalfOf: 'Леша' })

    // Exactly one draft in the window pays the debt down — every other day
    // is an ordinary close with no onBehalfOf, so the debt isn't rediscovered
    // and re-settled on a later day in the same run.
    expect(drafts.filter((draft) => draft.onBehalfOf != null)).toHaveLength(1)

    const applied: LedgerEntry[] = drafts.map((draft, index) => ({
      id: `auto-${index}`,
      ts: 100 + index,
      ...draft,
    }))
    expect(foldDebt([debtEntry, ...applied])).toEqual({ Леша: 0, Карина: 0 })
  })
})
