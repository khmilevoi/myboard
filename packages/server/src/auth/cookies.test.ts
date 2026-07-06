import { describe, expect, it } from 'vitest'

import { clearCookie, parseCookies, serializeCookie } from './cookies'

describe('serializeCookie', () => {
  it('builds an exact session-style cookie string (SameSite=Lax, HttpOnly, Secure, Path=/, Max-Age)', () => {
    const result = serializeCookie('__Host-mb_session', 'sess-123', {
      maxAgeMs: 30 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })

    expect(result).toBe(
      '__Host-mb_session=sess-123; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax',
    )
  })

  it('builds an exact challenge-style cookie string (SameSite=Strict)', () => {
    const result = serializeCookie('__Host-mb_chal', 'chal-abc', {
      maxAgeMs: 5 * 60 * 1000,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      path: '/',
    })

    expect(result).toBe(
      '__Host-mb_chal=chal-abc; Max-Age=300; Path=/; HttpOnly; Secure; SameSite=Strict',
    )
  })

  it('defaults Path to / when not given', () => {
    const result = serializeCookie('name', 'value', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    })

    expect(result).toBe('name=value; Path=/; HttpOnly; Secure; SameSite=Lax')
  })

  it('omits Max-Age when not provided', () => {
    const result = serializeCookie('name', 'value', {
      httpOnly: false,
      secure: false,
      sameSite: 'Lax',
    })

    expect(result).toBe('name=value; Path=/; SameSite=Lax')
  })

  it('drops Secure when secure is false (dev/e2e http)', () => {
    const result = serializeCookie('mb_chal', 'chal-abc', {
      maxAgeMs: 5 * 60 * 1000,
      httpOnly: true,
      secure: false,
      sameSite: 'Strict',
      path: '/',
    })

    expect(result).toBe('mb_chal=chal-abc; Max-Age=300; Path=/; HttpOnly; SameSite=Strict')
  })
})

describe('clearCookie', () => {
  it('produces Max-Age=0 with an empty value', () => {
    const result = clearCookie('__Host-mb_session', {
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      path: '/',
    })

    expect(result).toBe('__Host-mb_session=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax')
  })
})

describe('parseCookies', () => {
  it('parses multiple cookie pairs from a header', () => {
    expect(parseCookies('a=1; b=2; c=three')).toEqual({ a: '1', b: '2', c: 'three' })
  })

  it('returns an empty object for a missing header', () => {
    expect(parseCookies(undefined)).toEqual({})
  })

  it('decodes URI-encoded values', () => {
    expect(parseCookies('token=abc%2Fdef')).toEqual({ token: 'abc/def' })
  })
})
