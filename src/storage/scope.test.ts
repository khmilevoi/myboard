import { describe, expect, it } from 'vitest'
import { StorageError } from './types'
import { instanceNamespace, typeNamespace, toFullKey, toRelativeKey } from './scope'

describe('scope', () => {
  it('builds instance and type namespaces', () => {
    expect(instanceNamespace('abc')).toBe('w:i:abc:')
    expect(typeNamespace('clock')).toBe('w:t:clock:')
  })

  it('round-trips full and relative keys', () => {
    const ns = instanceNamespace('abc')
    const full = toFullKey(ns, 'draft')
    expect(full).toBe('w:i:abc:draft')
    expect(toRelativeKey(ns, full)).toBe('draft')
  })

  it('leaves a key unchanged when it does not start with the namespace', () => {
    expect(toRelativeKey('w:i:abc:', 'other:key')).toBe('other:key')
  })
})

describe('StorageError', () => {
  it('interpolates the reason and is an Error', () => {
    const err = new StorageError({ reason: 'read failed' })
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('read failed')
  })
})
