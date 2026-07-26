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
    })
  })
})

describe('makeForgiveDraft', () => {
  it('is null when the target is not a debt day', () => {
    expect(makeForgiveDraft({ ...base, target: D('2026-06-16') })).toBeNull()
  })

  it('forgives the debtor on a debt day', () => {
    const entries = [entry({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })]

    expect(makeForgiveDraft({ ...base, entries, target: D('2026-06-18') })).toEqual({
      date: '2026-06-18',
      type: 'forgiven',
      actor: 'Леша',
      onBehalfOf: 'Карина',
      createdBy: KARINA,
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
    })
  })
})

describe('makeCommentDraft', () => {
  it('trims the text', () => {
    expect(makeCommentDraft({ text: '  привет  ', createdBy: KARINA })).toEqual({
      text: 'привет',
      createdBy: KARINA,
    })
  })

  it('is null for blank text', () => {
    expect(makeCommentDraft({ text: '   ', createdBy: KARINA })).toBeNull()
  })
})
