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
  createdBy: CreatedBySchema.nullish().describe(
    'Account that created the record; null when unattributed',
  ),
  by: PersonSchema.optional().describe(
    'LEGACY pre-account signature. Read-only: never written again',
  ),
})

export type LedgerEntry = z.infer<typeof LedgerEntrySchema>
export type LedgerEntryDraft = Omit<LedgerEntry, 'id' | 'ts' | 'by'>
export const LedgerEntriesSchema = z.array(LedgerEntrySchema)

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
    if (!prev || entry.ts > prev.ts) latest.set(entry.date, entry)
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
