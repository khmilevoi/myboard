import type { ScopedBranch } from '@shared/storage/scoped'
import { describe, expect, it } from 'vitest'

import {
  ScopedKeyInvalidError,
  ScopedRouteUnknownError,
  makeScopedOwners,
  resolveScopedNamespace,
  validateScopedKey,
} from './scoped'

const owners = makeScopedOwners({
  widgetTypeIds: ['clock'],
  moduleScopes: { notes: ['shared', 'account'], board: ['shared'] },
})
const resolve = (branch: ScopedBranch, accountId: string | null = 'acc1') =>
  resolveScopedNamespace({ owners, branch, accountId })

describe('resolveScopedNamespace', () => {
  it('resolves each valid branch to its namespace', () => {
    expect(resolve({ owner: 'widget', id: 'clock', scope: 'account' })).toBe('w:a:clock:acc1:')
    expect(resolve({ owner: 'module', id: 'notes', scope: 'shared' })).toBe('m:notes:s:')
    expect(resolve({ owner: 'module', id: 'notes', scope: 'account' })).toBe('m:notes:a:acc1:')
  })
  it('rejects widget/shared as an unknown route', () =>
    expect(resolve({ owner: 'widget', id: 'clock', scope: 'shared' })).toBeInstanceOf(
      ScopedRouteUnknownError,
    ))
  it('rejects an unknown id with 404', () =>
    expect(resolve({ owner: 'module', id: 'nope', scope: 'shared' })).toMatchObject({
      status: 404,
      code: 'scoped_owner_unknown',
    }))
  it('rejects an undeclared module scope with 403', () =>
    expect(resolve({ owner: 'module', id: 'board', scope: 'account' })).toMatchObject({
      status: 403,
    }))
  it('requires a session for account scopes only', () => {
    expect(resolve({ owner: 'module', id: 'notes', scope: 'account' }, null)).toMatchObject({
      status: 401,
      code: 'session_missing',
    })
    expect(resolve({ owner: 'module', id: 'notes', scope: 'shared' }, null)).toBe('m:notes:s:')
  })
})

describe('validateScopedKey', () => {
  it('accepts valid keys and rejects invalid ones', () => {
    expect(validateScopedKey('a/b')).toBe('a/b')
    expect(validateScopedKey('../x')).toBeInstanceOf(ScopedKeyInvalidError)
    expect(validateScopedKey('')).toMatchObject({ status: 422, code: 'scoped_key_invalid' })
  })
})
