import { describe, expect, it } from 'vitest'

import { autoApproveDrafts } from './day-close'
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

  it('does not settle anybody’s debt', () => {
    const drafts = autoApproveDrafts({
      entries: [
        entry({ date: '2026-06-11', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
      ],
      scheduledForMs: SCHEDULED_FOR,
    })

    // getDebtDays hands debts forward from "today", so a past date carries no
    // debt assignment: every draft names the planned duty person and none
    // carries onBehalfOf, which is what keeps foldDebt from crediting a
    // repayment nobody made.
    expect(drafts.every((draft) => draft.onBehalfOf === undefined)).toBe(true)
  })
})
