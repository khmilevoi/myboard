import { describe, expect, it } from 'vitest'

import { AuthConfigError, loadAuthConfig, parseDuration } from './config'

const validHttpsEnv = {
  RP_ID: 'board.iiskelo.com',
  RP_NAME: 'MyBoard',
  EXPECTED_ORIGIN: 'https://board.iiskelo.com',
  SESSION_TTL_SLIDING: '30d',
  SESSION_TTL_ABSOLUTE: '90d',
  TRUST_CF_CONNECTING_IP: '1',
}

describe('loadAuthConfig', () => {
  it('returns secure __Host- cookies and exact TTL ms for a full https env', () => {
    expect(loadAuthConfig(validHttpsEnv)).toEqual({
      rpID: 'board.iiskelo.com',
      rpName: 'MyBoard',
      expectedOrigin: 'https://board.iiskelo.com',
      sessionCookieName: '__Host-mb_session',
      challengeCookieName: '__Host-mb_chal',
      pendingCookieName: '__Host-mb_pending',
      sessionTtlSlidingMs: 2_592_000_000,
      sessionTtlAbsoluteMs: 7_776_000_000,
      secureCookies: true,
      trustCfConnectingIp: true,
    })
  })

  it('drops the __Host- prefix and secureCookies for a dev http origin', () => {
    const result = loadAuthConfig({
      ...validHttpsEnv,
      EXPECTED_ORIGIN: 'http://localhost:4173',
    })
    expect(result).toEqual({
      rpID: 'board.iiskelo.com',
      rpName: 'MyBoard',
      expectedOrigin: 'http://localhost:4173',
      sessionCookieName: 'mb_session',
      challengeCookieName: 'mb_chal',
      pendingCookieName: 'mb_pending',
      sessionTtlSlidingMs: 2_592_000_000,
      sessionTtlAbsoluteMs: 7_776_000_000,
      secureCookies: false,
      trustCfConnectingIp: true,
    })
  })

  it('returns a tagged error naming the missing var when RP_ID is absent', () => {
    const { RP_ID: _RP_ID, ...rest } = validHttpsEnv
    const result = loadAuthConfig(rest)
    expect(result).toBeInstanceOf(AuthConfigError)
    expect((result as AuthConfigError).message).toContain('RP_ID')
  })
})

describe('parseDuration', () => {
  it('parses a day-suffixed duration to milliseconds', () => {
    expect(parseDuration('7d')).toBe(604_800_000)
  })

  it('returns an Error for an unparseable duration', () => {
    expect(parseDuration('bad')).toBeInstanceOf(Error)
  })
})
