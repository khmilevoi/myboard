import type { CommentDraft } from './comments'
import { foldDebt, getDebtDays } from './debt'
import type { CreatedBy, EntryCreatedBy, LedgerEntry, LedgerEntryDraft } from './ledger'
import { resolveDays } from './ledger'
import { PersonSchema, getOfeliaDutyByDate, otherPerson } from './roster'

export type DraftInput = {
  entries: LedgerEntry[]
  today: Temporal.PlainDate
  target: Temporal.PlainDate
  createdBy: EntryCreatedBy | null
  /**
   * Only the auto-close cron (day-close.ts) may set this. Debt days are
   * projected forward from a scan origin; anchoring the scan at `today`
   * alone puts every day before it permanently out of reach, so the cron
   * — which only ever asks about days strictly in the past — could never
   * match its own debt day (F1). The cron opts into scanning from
   * `min(target, today)` instead.
   *
   * The interactive `clean`/`debt`/`forgive` handlers in server.ts must
   * leave this unset: the client's own projection (ofelia-duty.ts) still
   * scans from `today` only, so a past open day never shows a debt marker
   * on screen. If the manual path also scanned from the past, a user
   * tapping a plain-looking past day could silently settle a stranger's
   * debt the UI never told them about (F1 fixed too broadly — see the
   * regression test below).
   */
  allowPastDebtDays?: boolean
}

function debtDayFor({ entries, today, target, allowPastDebtDays }: DraftInput) {
  const scanOrigin =
    allowPastDebtDays && Temporal.PlainDate.compare(target, today) < 0 ? target : today
  return getDebtDays(foldDebt(entries), scanOrigin, resolveDays(entries)).find((day) =>
    day.date.equals(target),
  )
}

// F2a: pre-release (main) clients require `by`/`author` — see the schema
// comments in ledger.ts / comments.ts. `actor` is always a rotation member,
// so reusing it is exact, not a guess.

export function makeCleanDraft(input: DraftInput): LedgerEntryDraft {
  const debtDay = debtDayFor(input)
  const duty = getOfeliaDutyByDate(input.target)
  const actor = debtDay?.person ?? duty

  return {
    date: input.target.toString(),
    type: 'cleaned',
    actor,
    ...(debtDay ? { onBehalfOf: duty } : {}),
    createdBy: input.createdBy,
    by: actor,
  }
}

export function makeDebtDraft(input: DraftInput): LedgerEntryDraft {
  const scheduled = debtDayFor(input)?.person ?? getOfeliaDutyByDate(input.target)
  const actor = otherPerson(scheduled)

  return {
    date: input.target.toString(),
    type: 'went_into_debt',
    actor,
    onBehalfOf: scheduled,
    createdBy: input.createdBy,
    by: actor,
  }
}

export function makeForgiveDraft(input: DraftInput): LedgerEntryDraft | null {
  const debtDay = debtDayFor(input)
  if (debtDay == null) return null

  const duty = getOfeliaDutyByDate(input.target)
  if (debtDay.person === duty) return null

  return {
    date: input.target.toString(),
    type: 'forgiven',
    actor: duty,
    onBehalfOf: debtDay.person,
    createdBy: input.createdBy,
    by: duty,
  }
}

export function makeUndoDraft(input: DraftInput): LedgerEntryDraft | null {
  const resolution = resolveDays(input.entries).get(input.target.toString())
  if (resolution?.status !== 'closed') return null

  return {
    date: input.target.toString(),
    type: 'reset',
    // The day's previous outcome — whose closure is being undone, NOT who is
    // undoing it. The UI must never phrase this as "X reopened the day".
    actor: resolution.actor,
    createdBy: input.createdBy,
    by: resolution.actor,
  }
}

// F2a: comments carry no rotation-person field of their own, so the legacy
// `author` is derived from the authoring account's display name — matched
// against the rotation only when it happens to spell a member exactly.
// There is no truthful rotation-member value for any other account (unlike
// the ledger's `by`, where `actor` genuinely IS a rotation member), so a
// non-matching name yields `undefined` rather than a fabricated identity:
// a fabricated one permanently misattributes a real comment to a real
// person in an append-only store.
//
// Know the cost before relying on this shim. main's `CommentsSchema` is a
// plain `z.array(CommentSchema)` with `author` REQUIRED, so it fails
// WHOLESALE on one authorless element — a main-era reader loses the entire
// week's thread, not just this comment. (The per-element tolerance that
// would make it degrade one row at a time is new in comments.ts and only
// protects the new client.) Account names are free text chosen at invite
// time, so 'Лёша' or a guest account is enough to trigger it. The ledger's
// `by` has no such exposure: `actor` is always a rotation member.
// Accepted for the one-release window on the grounds that the alternative
// — a permanent false attribution — outlives the shim; a stale reader
// recovers on reload, the data is never wrong.
function legacyAuthorFor(createdBy: CreatedBy | null) {
  const parsed = PersonSchema.safeParse(createdBy?.name)
  return parsed.success ? parsed.data : undefined
}

export function makeCommentDraft({
  text,
  createdBy,
}: {
  text: string
  createdBy: CreatedBy | null
}): CommentDraft | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const author = legacyAuthorFor(createdBy)
  return { text: trimmed, createdBy, ...(author !== undefined ? { author } : {}) }
}
