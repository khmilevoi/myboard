import { describe, expect, it } from 'vitest'

import { moduleAccountNamespace, moduleSharedNamespace, widgetAccountNamespace } from './scope'
import { isValidRelativeKey, isValidScopedPair, scopedBranchPath, scopedEventKey } from './scoped'

describe('scoped namespaces', () => {
  it('derives the persisted key shapes', () => {
    expect(widgetAccountNamespace('clock', 'acc1')).toBe('w:a:clock:acc1:')
    expect(moduleSharedNamespace('ofelia')).toBe('m:ofelia:s:')
    expect(moduleAccountNamespace('ofelia', 'acc1')).toBe('m:ofelia:a:acc1:')
  })
})

describe('isValidRelativeKey', () => {
  it.each(['ledger', 'duty/ledger', 'duty/comments:2026-06-15', 'a.b_c-d'])('accepts %s', (key) =>
    expect(isValidRelativeKey(key)).toBe(true),
  )
  it.each(['', 'x'.repeat(129), 'a b', 'me@mail.com', 'duty/../x', '..', 'кот'])(
    'rejects %s',
    (key) => expect(isValidRelativeKey(key)).toBe(false),
  )
})

it('allows exactly the three owner/scope pairs', () => {
  expect(isValidScopedPair({ owner: 'widget', scope: 'account' })).toBe(true)
  expect(isValidScopedPair({ owner: 'module', scope: 'shared' })).toBe(true)
  expect(isValidScopedPair({ owner: 'module', scope: 'account' })).toBe(true)
  expect(isValidScopedPair({ owner: 'widget', scope: 'shared' })).toBe(false)
})

it('builds the branch path and the frame key without any account id', () => {
  expect(scopedBranchPath({ owner: 'module', id: 'a b', scope: 'account' })).toBe(
    '/scoped/module/a%20b/account',
  )
  expect(scopedEventKey({ owner: 'module', id: 'ofelia', scope: 'account', key: 'duty/x' })).toBe(
    'scoped:module/ofelia/account/duty/x',
  )
})
