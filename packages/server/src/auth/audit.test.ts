import { describe, expect, it, vi } from 'vitest'

import type { AuthConfig } from './config'
import { auditFor, auditIp, makeAuditLogger } from './audit'

const baseConfig = { trustCfConnectingIp: false } as AuthConfig

describe('makeAuditLogger', () => {
  it('writes one JSON line with ts and the event fields', () => {
    const write = vi.fn()
    const audit = makeAuditLogger(write)
    audit({ event: 'login', accountId: 'a1', credentialId: 'c1', ip: '1.2.3.4', ua: 'UA' })

    expect(write).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(write.mock.calls[0][0] as string)
    expect(parsed).toMatchObject({
      event: 'login',
      accountId: 'a1',
      credentialId: 'c1',
      ip: '1.2.3.4',
      ua: 'UA',
    })
    expect(typeof parsed.ts).toBe('string')
    expect(Number.isNaN(Date.parse(parsed.ts))).toBe(false)
  })
})

describe('auditIp', () => {
  const req = (headers: Record<string, string>) =>
    ({ headers, socket: { remoteAddress: '10.0.0.9' } }) as never

  it('ignores CF-Connecting-IP unless trusted', () => {
    expect(auditIp(req({ 'cf-connecting-ip': '203.0.113.7' }), baseConfig)).toBe('10.0.0.9')
  })

  it('uses CF-Connecting-IP when trusted', () => {
    const config = { ...baseConfig, trustCfConnectingIp: true } as AuthConfig
    expect(auditIp(req({ 'cf-connecting-ip': '203.0.113.7' }), config)).toBe('203.0.113.7')
  })
})

describe('auditFor', () => {
  it('binds ip and ua once and merges the event fields', () => {
    const audit = vi.fn()
    const req = { headers: { 'user-agent': 'UA' }, socket: { remoteAddress: '10.0.0.9' } } as never
    const emit = auditFor({ audit, config: baseConfig }, req)

    emit('login', { accountId: 'a1' })
    expect(audit).toHaveBeenCalledWith({ event: 'login', accountId: 'a1', ip: '10.0.0.9', ua: 'UA' })
  })

  it('omits ua when the request carries none', () => {
    const audit = vi.fn()
    const req = { headers: {}, socket: { remoteAddress: '10.0.0.9' } } as never
    auditFor({ audit, config: baseConfig }, req)('logout')
    expect(audit).toHaveBeenCalledWith({ event: 'logout', ip: '10.0.0.9' })
  })
})
