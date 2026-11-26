import { describe, expect, it } from 'vitest'

import { makeCleanDraft, makeDebtDraft, makeForgiveDraft, makeUndoDraft } from './drafts'
import type { DraftInput } from './drafts'
import type { LedgerEntry, LedgerEntryDraft } from './ledger'
import { STATS_WINDOW_DAYS, memberStats } from './stats'

const D = (iso: string) => Temporal.PlainDate.from(iso)
const KARINA = { accountId: 'a1', name: 'Карина' }

type Maker = (input: DraftInput) => LedgerEntryDraft | null

/** Replays actions through the real draft makers, each taken on its own day, the way the server
 *  appends them: a fresh id and an increasing `ts` per record. */
function replay(actions: [Maker, string][]): LedgerEntry[] {
  return actions.reduce<LedgerEntry[]>((entries, [make, iso]) => {
    const draft = make({ entries, today: D(iso), target: D(iso), createdBy: KARINA })
    if (draft === null) throw new Error(`no draft for ${iso}`)
    const ts = entries.length + 1
    return [...entries, { ...draft, id: `e${ts}`, ts }]
  }, [])
}

describe('memberStats', () => {
  it('uses a 30-day window by default', () => {
    expect(STATS_WINDOW_DAYS).toBe(30)
  })

  // today 2026-06-30, so the 30-day window starts at 2026-06-01. 2026-06-16 is Леша's day and the
  // rotation alternates, so even days of June are Леша's and odd days are Карина's.
  it('credits every closed day to the member who physically cleaned it', () => {
    const entries = replay([
      [makeCleanDraft, '2026-05-31'], // Леша, outside the window
      [makeCleanDraft, '2026-06-01'], // Карина, her own day
      [makeCleanDraft, '2026-06-15'], // Карина…
      [makeUndoDraft, '2026-06-15'], // …undone: nobody
      [makeDebtDraft, '2026-06-20'], // Леша's day missed: Карина covers it
      [makeCleanDraft, '2026-06-21'], // Леша repays on Карина's day
      [makeDebtDraft, '2026-06-22'], // Леша's day missed again: Карина covers it
      [makeForgiveDraft, '2026-06-23'], // Карина cleans her own day, waiving the repayment
      [makeCleanDraft, '2026-06-30'], // Леша, his own day
    ])

    // The fixtures are the shapes the makers produce, not hand-written guesses.
    expect(entries.find((e) => e.date === '2026-06-20')).toMatchObject({
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
    })
    expect(entries.find((e) => e.date === '2026-06-21')).toMatchObject({
      type: 'cleaned',
      actor: 'Леша',
      onBehalfOf: 'Карина',
    })
    expect(entries.find((e) => e.date === '2026-06-23')).toMatchObject({
      type: 'forgiven',
      actor: 'Карина',
      onBehalfOf: 'Леша',
    })

    expect(memberStats({ entries, today: D('2026-06-30'), windowDays: 30 })).toEqual([
      { person: 'Леша', cleanings: 2, debt: 0 },
      { person: 'Карина', cleanings: 4, debt: 0 },
    ])
  })

  it('counts a covered day for the coverer and reports the debt it creates', () => {
    const entries = replay([[makeDebtDraft, '2026-06-30']]) // Леша's day: Карина covers

    expect(memberStats({ entries, today: D('2026-06-30'), windowDays: 30 })).toEqual([
      { person: 'Леша', cleanings: 0, debt: 1 },
      { person: 'Карина', cleanings: 1, debt: 0 },
    ])
  })

  it('ignores days after today', () => {
    const entries = replay([[makeCleanDraft, '2026-07-01']])

    expect(memberStats({ entries, today: D('2026-06-30'), windowDays: 30 })).toEqual([
      { person: 'Леша', cleanings: 0, debt: 0 },
      { person: 'Карина', cleanings: 0, debt: 0 },
    ])
  })

  it('returns a zero row for every rotation member on an empty ledger', () => {
    expect(memberStats({ entries: [], today: D('2026-06-30'), windowDays: 30 })).toEqual([
      { person: 'Леша', cleanings: 0, debt: 0 },
      { person: 'Карина', cleanings: 0, debt: 0 },
    ])
  })
})
