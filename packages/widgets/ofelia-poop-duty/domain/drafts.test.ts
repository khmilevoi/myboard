// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  makeCleanDraft,
  makeCommentDraft,
  makeDebtDraft,
  makeForgiveDraft,
  makeUndoDraft,
} from './drafts'
import type { LedgerEntry } from './ledger'
import { PersonSchema } from './roster'

const D = (iso: string) => Temporal.PlainDate.from(iso)
const KARINA = { accountId: 'a1', name: 'Карина' }

// 2026-06-16 is BASE_DUTY_DATE_ISO, so it is Леша's day; 06-17 is Карина's.
const base = { entries: [] as LedgerEntry[], today: D('2026-06-16'), createdBy: KARINA }

let seq = 0
const entry = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`,
  ts: seq,
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  ...o,
})

describe('makeCleanDraft', () => {
  it('credits the scheduled duty person on a plain day', () => {
    expect(makeCleanDraft({ ...base, target: D('2026-06-16') })).toEqual({
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it('credits the debtor and names the scheduled person on a debt day', () => {
    const entries = [entry({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })]
    // Карина owes one day, so the next day that is not hers (06-17 is hers,
    // 06-18 is Лешa's) becomes her debt day.
    const draft = makeCleanDraft({ ...base, entries, target: D('2026-06-18') })

    expect(draft).toEqual({
      date: '2026-06-18',
      type: 'cleaned',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      createdBy: KARINA,
      by: 'Карина',
    })
  })

  it('resolves a debt day even when the target is in the past relative to today, when the caller opts in (F1)', () => {
    // Карина owes one day. `today` (06-19) is well after the target (06-12),
    // exactly the shape of the auto-close cron closing a day behind "now" —
    // only the cron (via autoApproveDrafts) sets allowPastDebtDays.
    const entries = [
      entry({ date: '2026-06-11', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
    ]
    const draft = makeCleanDraft({
      entries,
      today: D('2026-06-19'),
      target: D('2026-06-12'),
      createdBy: null,
      allowPastDebtDays: true,
    })

    expect(draft.actor).toBe('Карина')
    expect(draft.onBehalfOf).toBe('Леша')
  })

  it('does NOT resolve a past debt day for a manual close — matches what the client showed (F1 regression)', () => {
    // Same debt as above, but this is the interactive path (no
    // allowPastDebtDays): the client's own projection only scans debt days
    // forward from `today`, so it never marked 06-12 as a debt day on
    // screen. A manual tap on that day must stay a plain close by the
    // scheduled duty person, not silently settle Карина's debt for her.
    const entries = [
      entry({ date: '2026-06-11', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
    ]
    const draft = makeCleanDraft({
      entries,
      today: D('2026-06-19'),
      target: D('2026-06-12'),
      createdBy: null,
    })

    // 06-12 is Леша's own scheduled duty day (base 06-16 is his, and the
    // rotation alternates daily), so a plain close credits him — Карина's
    // debt is left untouched, exactly as it was before F1.
    expect(draft).toEqual({
      date: '2026-06-12',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: null,
      by: 'Леша',
    })
  })
})

describe('makeDebtDraft', () => {
  it('puts the scheduled person into debt and hands the day to the other one', () => {
    expect(makeDebtDraft({ ...base, target: D('2026-06-16') })).toEqual({
      date: '2026-06-16',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      createdBy: KARINA,
      by: 'Карина',
    })
  })

  it('a manual debt on a past day still uses the scheduled duty, unaffected by an unrelated outstanding debt (F1 regression)', () => {
    // Same outstanding debt as the makeCleanDraft regression above, and the
    // same target/today shape — no allowPastDebtDays, so debtDayFor cannot
    // see 06-12 as a debt day and this behaves exactly as it did before F1.
    const entries = [
      entry({ date: '2026-06-11', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
    ]
    const draft = makeDebtDraft({
      entries,
      today: D('2026-06-19'),
      target: D('2026-06-12'),
      createdBy: null,
    })

    // Scheduled duty on 06-12 is Леша, so the debt is charged to him — not
    // rediscovered off Карина's already-outstanding debt.
    expect(draft).toEqual({
      date: '2026-06-12',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      createdBy: null,
      by: 'Карина',
    })
  })
})

describe('makeForgiveDraft', () => {
  it('is null when the target is not a debt day', () => {
    expect(makeForgiveDraft({ ...base, target: D('2026-06-16') })).toBeNull()
  })

  it('is null on a manual past-day target even when an unrelated debt is outstanding (F1 regression)', () => {
    // Same shape as the makeCleanDraft/makeDebtDraft regressions: no
    // allowPastDebtDays, so debtDayFor cannot resolve 06-12 as a debt day
    // and there is nothing to forgive there, matching pre-F1 behavior.
    const entries = [
      entry({ date: '2026-06-11', type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' }),
    ]
    const draft = makeForgiveDraft({
      entries,
      today: D('2026-06-19'),
      target: D('2026-06-12'),
      createdBy: null,
    })

    expect(draft).toBeNull()
  })

  it('forgives the debtor on a debt day', () => {
    const entries = [entry({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })]

    expect(makeForgiveDraft({ ...base, entries, target: D('2026-06-18') })).toEqual({
      date: '2026-06-18',
      type: 'forgiven',
      actor: 'Леша',
      onBehalfOf: 'Карина',
      createdBy: KARINA,
      by: 'Леша',
    })
  })
})

describe('makeUndoDraft', () => {
  it('is null when the day is still open', () => {
    expect(makeUndoDraft({ ...base, target: D('2026-06-16') })).toBeNull()
  })

  it('reopens a closed day and names whose closure was undone', () => {
    const entries = [entry({ type: 'cleaned', actor: 'Леша' })]

    expect(makeUndoDraft({ ...base, entries, target: D('2026-06-16') })).toEqual({
      date: '2026-06-16',
      type: 'reset',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })
})

describe('makeCommentDraft', () => {
  it('trims the text', () => {
    expect(makeCommentDraft({ text: '  привет  ', createdBy: KARINA })).toEqual({
      text: 'привет',
      createdBy: KARINA,
      author: 'Карина',
    })
  })

  it('is null for blank text', () => {
    expect(makeCommentDraft({ text: '   ', createdBy: KARINA })).toBeNull()
  })
})

// F2a: pre-release (main) clients require `by` on every ledger entry and
// `author` on every comment, both as a rotation member — see the schema
// comments in ledger.ts / comments.ts. Without these fields the first record
// written after deploy fails `z.array(...)` wholesale and bricks the widget
// for every still-open old client.
describe('main-era compatibility (F2a)', () => {
  it('makeCleanDraft emits a legacy `by` matching the actor', () => {
    const draft = makeCleanDraft({ ...base, target: D('2026-06-16') })
    expect(PersonSchema.safeParse(draft.by).success).toBe(true)
    expect(draft.by).toBe(draft.actor)
  })

  it('makeDebtDraft emits a legacy `by` matching the actor', () => {
    const draft = makeDebtDraft({ ...base, target: D('2026-06-16') })
    expect(PersonSchema.safeParse(draft.by).success).toBe(true)
    expect(draft.by).toBe(draft.actor)
  })

  it('makeForgiveDraft emits a legacy `by` matching the actor', () => {
    const entries = [entry({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })]
    const draft = makeForgiveDraft({ ...base, entries, target: D('2026-06-18') })
    expect(draft).not.toBeNull()
    expect(PersonSchema.safeParse(draft?.by).success).toBe(true)
    expect(draft?.by).toBe(draft?.actor)
  })

  it('makeUndoDraft emits a legacy `by` matching the actor', () => {
    const entries = [entry({ type: 'cleaned', actor: 'Леша' })]
    const draft = makeUndoDraft({ ...base, entries, target: D('2026-06-16') })
    expect(draft).not.toBeNull()
    expect(PersonSchema.safeParse(draft?.by).success).toBe(true)
    expect(draft?.by).toBe(draft?.actor)
  })

  it('makeCommentDraft emits a valid legacy `author` matching the account name', () => {
    const draft = makeCommentDraft({ text: 'привет', createdBy: KARINA })
    expect(draft).not.toBeNull()
    expect(PersonSchema.safeParse(draft?.author).success).toBe(true)
    expect(draft?.author).toBe('Карина')
  })

  it('makeCommentDraft omits `author` rather than falsifying it when the account name is not a rotation member', () => {
    // There is no truthful rotation-member value for "Guest" — unlike the
    // ledger's `by` (where `actor` genuinely is a rotation member), a
    // fabricated author here would permanently misattribute a real comment
    // to a real person in the append-only comments store. The cost is that
    // main's required-`author` `z.array` fails wholesale, so a main-era
    // reader loses that whole week's thread until it reloads onto the new
    // bundle — see the rationale on `legacyAuthorFor`.
    const draft = makeCommentDraft({
      text: 'привет',
      createdBy: { accountId: 'a9', name: 'Guest' },
    })
    expect(draft).not.toBeNull()
    expect(draft).not.toHaveProperty('author')
  })

  it('makeCommentDraft omits `author` when createdBy is null', () => {
    const draft = makeCommentDraft({ text: 'привет', createdBy: null })
    expect(draft).not.toBeNull()
    expect(draft).not.toHaveProperty('author')
  })
})
