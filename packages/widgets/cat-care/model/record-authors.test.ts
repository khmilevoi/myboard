import { describe, expect, it } from 'vitest'

import type { LedgerEntry } from '../domain/schemas'
import { projectRecordAuthors } from './record-authors'

const original = { accountId: 'anna', name: 'Анна' }
const editor = { accountId: 'boris', name: 'Борис' }
const members = new Map([
  [original.accountId, original],
  [editor.accountId, editor],
])
function save(
  entity: 'food' | 'water' | 'weight',
  author: typeof original | null,
  mutationId: string,
): LedgerEntry {
  return {
    id: mutationId,
    mutationId,
    ts: 100,
    createdBy: author,
    command: { kind: `${entity}.save`, [entity]: { id: 'same-record' } },
  } as LedgerEntry
}
function remove(entity: 'food' | 'water' | 'weight'): LedgerEntry {
  return {
    id: `delete-${entity}`,
    mutationId: `delete-${entity}`,
    ts: 200,
    createdBy: editor,
    command: { kind: 'record.delete', entity, recordId: 'same-record' },
  }
}

describe('cat care original record authors', () => {
  it.each(['food', 'water', 'weight'] as const)(
    'retains the %s creator when another member edits it',
    (entity) => {
      const entries = [save(entity, original, 'created'), save(entity, editor, 'edited')]
      expect(projectRecordAuthors({ entries, members })[entity].get('same-record')).toEqual(
        original,
      )
    },
  )
  it('keeps anonymous historical creation unknown after an authenticated edit', () => {
    const entries = [save('food', null, 'created'), save('food', editor, 'edited')]
    expect(projectRecordAuthors({ entries, members }).food.get('same-record')).toBeNull()
  })
  it('resets the lifecycle after deletion, distinguishes record entities and deduplicates mutations', () => {
    const entries = [
      save('food', original, 'created'),
      save('water', original, 'water'),
      remove('food'),
      save('food', original, 'created'),
      save('food', editor, 'recreated'),
    ]
    const authors = projectRecordAuthors({ entries, members })
    expect(authors.food.get('same-record')).toEqual(editor)
    expect(authors.water.get('same-record')).toEqual(original)
    expect(
      projectRecordAuthors({ entries: [...entries, remove('water')], members }).water.has(
        'same-record',
      ),
    ).toBe(false)
  })
  it('resolves current public names and image URLs, falling back to the frozen name when removed', () => {
    const entries = [save('food', original, 'created')]
    const renamed = new Map([
      ['anna', { accountId: 'anna', name: 'Анна Новая', avatarUrl: '/avatars/anna.png' }],
    ])
    expect(projectRecordAuthors({ entries, members: renamed }).food.get('same-record')).toEqual(
      renamed.get('anna'),
    )
    expect(projectRecordAuthors({ entries, members: new Map() }).food.get('same-record')).toEqual(
      original,
    )
    const blank = [save('food', { ...original, name: '  ' }, 'created')]
    expect(
      projectRecordAuthors({ entries: blank, members: new Map() }).food.get('same-record')?.name,
    ).toBe('Автор неизвестен')
  })
})
