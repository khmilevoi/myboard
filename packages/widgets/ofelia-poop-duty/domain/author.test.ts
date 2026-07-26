// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { resolveEntryAuthor, type MemberLookup } from './author'

const members: MemberLookup = new Map([
  ['a1', { accountId: 'a1', name: 'Карина', avatarUrl: 'https://example.test/k.png' }],
])

describe('resolveEntryAuthor', () => {
  it('prefers the directory over the frozen snapshot', () => {
    expect(resolveEntryAuthor({ accountId: 'a1', name: 'старое имя' }, undefined, members)).toEqual(
      {
        kind: 'account',
        accountId: 'a1',
        name: 'Карина',
        avatarUrl: 'https://example.test/k.png',
      },
    )
  })

  it('falls back to the snapshot when the account is gone', () => {
    expect(resolveEntryAuthor({ accountId: 'gone', name: 'Лёша' }, undefined, members)).toEqual({
      kind: 'account',
      accountId: 'gone',
      name: 'Лёша',
    })
  })

  it('falls back to the legacy duty signature', () => {
    expect(resolveEntryAuthor(null, 'Леша', members)).toEqual({ kind: 'person', person: 'Леша' })
  })

  it('is unknown when there is neither', () => {
    expect(resolveEntryAuthor(null, undefined, members)).toEqual({ kind: 'unknown' })
  })

  it('prefers createdBy over a legacy signature when both are present', () => {
    expect(resolveEntryAuthor({ accountId: 'a1', name: 'x' }, 'Леша', members).kind).toBe('account')
  })
})
