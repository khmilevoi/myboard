import type { BoardMember } from 'widget-runtime'

import type { LedgerEntry } from '../domain/schemas'

export type CatCareAuthor = BoardMember | null
export type RecordAuthors = {
  food: ReadonlyMap<string, CatCareAuthor>
  water: ReadonlyMap<string, CatCareAuthor>
  weight: ReadonlyMap<string, CatCareAuthor>
}

/** The first save owns a record. An edit describes a later actor, not its creator. */
export function projectRecordAuthors({
  entries,
  members,
}: {
  entries: LedgerEntry[]
  members: ReadonlyMap<string, BoardMember>
}): RecordAuthors {
  const authors = {
    food: new Map<string, CatCareAuthor>(),
    water: new Map<string, CatCareAuthor>(),
    weight: new Map<string, CatCareAuthor>(),
  }
  const seen = new Set<string>()
  for (const entry of entries) {
    if (seen.has(entry.mutationId)) continue
    seen.add(entry.mutationId)
    const command = entry.command
    if (command.kind === 'record.delete') {
      authors[command.entity].delete(command.recordId)
      continue
    }
    const entity =
      command.kind === 'food.save'
        ? 'food'
        : command.kind === 'water.save'
          ? 'water'
          : command.kind === 'weight.save'
            ? 'weight'
            : null
    if (!entity) continue
    const id =
      command.kind === 'food.save'
        ? command.food.id
        : command.kind === 'water.save'
          ? command.water.id
          : command.kind === 'weight.save'
            ? command.weight.id
            : ''
    const records = authors[entity]
    if (records.has(id)) continue
    const frozen = entry.createdBy
    if (!frozen) {
      records.set(id, null)
      continue
    }
    const member = members.get(frozen.accountId)
    records.set(id, {
      accountId: frozen.accountId,
      name: member?.name.trim() || frozen.name.trim() || 'Автор неизвестен',
      ...(member?.avatarUrl ? { avatarUrl: member.avatarUrl } : {}),
    })
  }
  return authors
}
