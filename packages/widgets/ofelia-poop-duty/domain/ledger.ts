import { z } from 'zod'

import { PersonSchema } from './roster'
import type { Person } from './roster'

export const LEDGER_KEY = 'ledger'

export const LedgerTypeSchema = z.enum(['cleaned', 'went_into_debt', 'reset', 'forgiven'])
export type LedgerType = z.infer<typeof LedgerTypeSchema>

export const CreatedBySchema = z.object({
  accountId: z.string(),
  name: z
    .string()
    .describe('Display name frozen at write time; the members directory overrides it'),
})
export type CreatedBy = z.infer<typeof CreatedBySchema>

/**
 * Records written by the server itself (cron jobs), with no session behind
 * them. A plain union rather than a discriminated one: the account shape is
 * already persisted without a discriminator field, and adding a required one
 * would invalidate every stored record.
 */
export const SystemCreatedBySchema = z.object({ system: z.literal(true) })
export const EntryCreatedBySchema = z.union([CreatedBySchema, SystemCreatedBySchema])
export type EntryCreatedBy = z.infer<typeof EntryCreatedBySchema>

export const SYSTEM_CREATED_BY: EntryCreatedBy = { system: true }

export const LedgerEntrySchema = z.object({
  id: z.string().describe('Уникальный идентификатор записи в append-only журнале'),
  ts: z
    .number()
    .describe(
      'Серверная метка времени создания записи для сортировки и выбора последнего решения дня',
    ),
  date: z.string().describe('ISO-дата дежурства, к которому относится действие'),
  type: LedgerTypeSchema.describe(
    'Тип действия: уборка, уход в долг, сброс решения или прощение долга',
  ),
  actor: PersonSchema.describe(
    'Человек, который фактически убрал, ушел в долг или связан с изменением долга',
  ),
  onBehalfOf: PersonSchema.optional().describe(
    'Человек, за которого выполнено действие или чей долг изменяется',
  ),
  createdBy: EntryCreatedBySchema.nullish().describe(
    'Account that created the record, the server for automatic records, or null when unattributed',
  ),
  by: PersonSchema.optional().describe(
    'LEGACY pre-account signature. F2a: written again for one release as a ' +
      'compat shim so pre-release (main) clients, which require this field ' +
      'and reject the whole ledger without it, can still read new entries. ' +
      'Drop the write side once no main-era bundle can be live.',
  ),
})

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
// `by` stays part of the draft shape (not omitted) only for the one-release
// compat shim above — see makeCleanDraft et al. in drafts.ts.
export type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts'>
// A single malformed element must not blank the whole ledger for everyone:
// parse per element and drop what doesn't validate instead of failing the
// array wholesale.
export const LedgerEntriesSchema = z.array(z.unknown()).transform((rawEntries) =>
  rawEntries.flatMap((raw) => {
    const parsed = LedgerEntrySchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('Dropping malformed ledger entry', parsed.error)
      return []
    }
    return [parsed.data]
  }),
)

const DAY_OUTCOME_TYPES: ReadonlySet<LedgerType> = new Set([
  'cleaned',
  'went_into_debt',
  'reset',
  'forgiven',
])

export function latestOutcomesByDate(entries: LedgerEntry[]): Map<string, LedgerEntry> {
  const latest = new Map<string, LedgerEntry>()
  for (const entry of entries) {
    if (!DAY_OUTCOME_TYPES.has(entry.type)) continue
    const prev = latest.get(entry.date)
    // `>=`, not `>`: the ledger is append-only and iterated in insertion
    // order, so on an equal timestamp the later-appended entry is the newer
    // decision. Ties are real — `ts` comes from the server's injectable clock
    // (`WidgetServerContext.now()`), which the e2e harness pins to a fixed
    // instant, and even in production two writes can land in the same
    // millisecond. With `>` a "clean then undo" pair kept the `cleaned` entry
    // as the day's outcome and the day never reopened.
    if (!prev || entry.ts >= prev.ts) latest.set(entry.date, entry)
  }
  return latest
}

export type DayResolution = {
  status: 'closed' | 'pending'
  type: LedgerType
  actor: Person
  onBehalfOf?: Person
}

export function resolveDays(entries: LedgerEntry[]): Map<string, DayResolution> {
  const out = new Map<string, DayResolution>()
  for (const [date, entry] of latestOutcomesByDate(entries)) {
    out.set(date, {
      status: entry.type === 'reset' ? 'pending' : 'closed',
      type: entry.type,
      actor: entry.actor,
      ...(entry.onBehalfOf ? { onBehalfOf: entry.onBehalfOf } : {}),
    })
  }
  return out
}
