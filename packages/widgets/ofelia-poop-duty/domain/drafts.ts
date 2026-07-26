import type { CommentDraft } from './comments'
import { foldDebt, getDebtDays } from './debt'
import type { CreatedBy, LedgerEntry, LedgerEntryDraft } from './ledger'
import { resolveDays } from './ledger'
import { getOfeliaDutyByDate, otherPerson } from './roster'

export type DraftInput = {
  entries: LedgerEntry[]
  today: Temporal.PlainDate
  target: Temporal.PlainDate
  createdBy: CreatedBy | null
}

function debtDayFor({ entries, today, target }: DraftInput) {
  return getDebtDays(foldDebt(entries), today, resolveDays(entries)).find((day) =>
    day.date.equals(target),
  )
}

export function makeCleanDraft(input: DraftInput): LedgerEntryDraft {
  const debtDay = debtDayFor(input)
  const duty = getOfeliaDutyByDate(input.target)

  return {
    date: input.target.toString(),
    type: 'cleaned',
    actor: debtDay?.person ?? duty,
    ...(debtDay ? { onBehalfOf: duty } : {}),
    createdBy: input.createdBy,
  }
}

export function makeDebtDraft(input: DraftInput): LedgerEntryDraft {
  const actor = debtDayFor(input)?.person ?? getOfeliaDutyByDate(input.target)

  return {
    date: input.target.toString(),
    type: 'went_into_debt',
    actor: otherPerson(actor),
    onBehalfOf: actor,
    createdBy: input.createdBy,
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
  }
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
  return { text: trimmed, createdBy }
}
