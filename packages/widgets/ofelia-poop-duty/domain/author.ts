import type { CreatedBy } from './ledger'
import type { Person } from './roster'

export type EntryAuthor =
  | { kind: 'account'; accountId: string; name: string; avatarUrl?: string }
  | { kind: 'person'; person: Person }
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
  createdBy: CreatedBy | null | undefined,
  legacy: Person | undefined,
  members: MemberLookup,
): EntryAuthor {
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
