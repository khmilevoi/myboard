import { describe, expect, it } from 'vitest'

import { isAllowedStorageKey, isAllowedStoragePrefix } from './access'

describe('isAllowedStorageKey', () => {
  it.each([
    'root:board',
    'w:i:placement-1:settings',
    'w:t:clock:settings',
    // Trailing garbage after a valid namespace is still someone else's
    // instance/type id, not a way out of the namespace.
    'w:t:clock:',
  ])('allows %s', (key) => {
    expect(isAllowedStorageKey(key)).toBe(true)
  })

  it.each([
    'session:abc',
    'device:abc',
    'account:abc',
    'account:abc:devices',
    'invite:abc',
    'deviceadd:abc',
    'wachal:abc',
    'pending:abc',
    'cron:ofelia-poop-duty:autoApproveDay',
    // Not a strict-prefix match of any allowed namespace.
    'w:',
    'w',
    '',
  ])('rejects %s', (key) => {
    expect(isAllowedStorageKey(key)).toBe(false)
  })
})

describe('isAllowedStoragePrefix', () => {
  it.each(['root:', 'w:i:', 'w:t:', 'w:t:clock:'])('allows %s', (prefix) => {
    expect(isAllowedStoragePrefix(prefix)).toBe(true)
  })

  it.each([
    '',
    'w',
    'w:',
    's',
    'session:',
    'root',
    // A strict prefix of an allowed namespace must not let scanKeys widen
    // the match beyond what the allowlist covers.
    'roo',
  ])('rejects %s', (prefix) => {
    expect(isAllowedStoragePrefix(prefix)).toBe(false)
  })
})
