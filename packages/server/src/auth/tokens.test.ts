import { describe, expect, it } from 'vitest'

import { randomId, randomToken, sha256hex } from './tokens'

describe('sha256hex', () => {
  it('hashes a known input to the known SHA-256 hex digest', () => {
    expect(sha256hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })
})

describe('randomToken', () => {
  it('generates two different tokens that each decode to 32 bytes', () => {
    const a = randomToken()
    const b = randomToken()
    expect(a).not.toBe(b)
    expect(Buffer.from(a, 'base64url')).toHaveLength(32)
    expect(Buffer.from(b, 'base64url')).toHaveLength(32)
  })
})

describe('randomId', () => {
  it('generates two different ids that each decode to 18 bytes by default', () => {
    const a = randomId()
    const b = randomId()
    expect(a).not.toBe(b)
    expect(Buffer.from(a, 'base64url')).toHaveLength(18)
  })

  it('respects a custom byte length', () => {
    expect(Buffer.from(randomId(8), 'base64url')).toHaveLength(8)
  })
})
