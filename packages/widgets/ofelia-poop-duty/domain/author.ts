import type { EntryCreatedBy } from './ledger'
import type { Person } from './roster'

export type EntryAuthor =
  | { kind: 'account'; accountId: string; name: string; avatarUrl?: string }
  | { kind: 'person'; person: Person }
  | { kind: 'system' }
  | { kind: 'unknown' }

/**
 * Structurally compatible with widget-runtime's
 * `ReadonlyMap<string, BoardMember>`, declared locally because domain code may
 * not import widget-runtime.
 */
export type MemberLookup = ReadonlyMap<
  string,
  { accountId: string; name: string; avatarUrl?: string }
>

export function resolveEntryAuthor(
  createdBy: EntryCreatedBy | null | undefined,
  legacy: Person | undefined,
  members: MemberLookup,
): EntryAuthor {
  if (createdBy && 'system' in createdBy) return { kind: 'system' }

  if (createdBy) {
    const member = members.get(createdBy.accountId)
    return {
      kind: 'account',
      accountId: createdBy.accountId,
      name: member?.name ?? createdBy.name,
      ...(member?.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
    }
  }

  if (legacy) return { kind: 'person', person: legacy }
  return { kind: 'unknown' }
}
