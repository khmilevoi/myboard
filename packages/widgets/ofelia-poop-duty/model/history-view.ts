import { resolveEntryAuthor, type EntryAuthor, type MemberLookup } from '@/domain/author'
import { latestOutcomesByDate, type LedgerEntry, type LedgerType } from '@/domain/ledger'
import { DUTY_TIME_ZONE, plainDateIn, weekStartISO, type Person } from '@/domain/roster'

export type HistoryEntryView = {
  id: string
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
  dutyDate: string
  recordedAt: number
  recordedBy: EntryAuthor
  isViewerRecord: boolean
  recordedLate: boolean
  debtDelta: { person: Person; amount: 1 | -1 } | null
}

export type HistoryDayGroup = {
  dutyDate: string
  /** The day's live outcome. Always present: every ledger type resolves a day. */
  current: HistoryEntryView
  /** Everything the live outcome overrides, newest first. */
  superseded: HistoryEntryView[]
}

/** Mirrors foldDebt: the same branches, expressed per entry. */
function debtDelta(entry: LedgerEntry): HistoryEntryView['debtDelta'] {
  if (!entry.onBehalfOf) return null
  if (entry.type === 'went_into_debt') return { person: entry.onBehalfOf, amount: 1 }
  if (entry.type === 'cleaned') return { person: entry.actor, amount: -1 }
  if (entry.type === 'forgiven') return { person: entry.onBehalfOf, amount: -1 }
  return null
}

export type ToHistoryGroupsOptions = {
  entries: LedgerEntry[]
  weekStartIso: string
  members: MemberLookup
  viewerAccountId: string | null
}

export function toHistoryGroups({
  entries,
  weekStartIso,
  members,
  viewerAccountId,
}: ToHistoryGroupsOptions): HistoryDayGroup[] {
  const inWeek = entries.filter(
    (entry) => weekStartISO(Temporal.PlainDate.from(entry.date)) === weekStartIso,
  )
  const winners = latestOutcomesByDate(inWeek)

  const toView = (entry: LedgerEntry): HistoryEntryView => {
    const recordedBy = resolveEntryAuthor(entry.createdBy, entry.by, members)
    return {
      id: entry.id,
      type: entry.type,
      actor: entry.actor,
      ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
      dutyDate: entry.date,
      recordedAt: entry.ts,
      recordedBy,
      isViewerRecord:
        recordedBy.kind === 'account' &&
        viewerAccountId !== null &&
        recordedBy.accountId === viewerAccountId,
      recordedLate: plainDateIn(DUTY_TIME_ZONE, entry.ts).toString() !== entry.date,
      debtDelta: debtDelta(entry),
    }
  }

  const byDate = new Map<string, LedgerEntry[]>()
  for (const entry of inWeek) {
    const bucket = byDate.get(entry.date)
    if (bucket) bucket.push(entry)
    else byDate.set(entry.date, [entry])
  }

  return [...byDate.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .flatMap(([dutyDate, dayEntries]) => {
      const winner = winners.get(dutyDate)
      if (!winner) return []

      return [
        {
          dutyDate,
          current: toView(winner),
          superseded: dayEntries
            .filter((entry) => entry.id !== winner.id)
            .toSorted((left, right) => right.ts - left.ts)
            .map(toView),
        },
      ]
    })
}
