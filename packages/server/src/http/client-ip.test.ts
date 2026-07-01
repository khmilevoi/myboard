import type { IncomingMessage } from 'node:http'

import { describe, expect, it } from 'vitest'

import { clientIp } from './client-ip'

function req(headers: IncomingMessage['headers'], remoteAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('clientIp', () => {
  it('prefers the first x-forwarded-for hop over socket.remoteAddress', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, '9.9.9.9'))).toBe('1.1.1.1')
  })

  it('uses the first x-forwarded-for header when the header is an array', () => {
    expect(clientIp(req({ 'x-forwarded-for': ['3.3.3.3, 4.4.4.4', '5.5.5.5'] }, '9.9.9.9'))).toBe(
      '3.3.3.3',
    )
  })

  it('falls back to socket.remoteAddress when no forwarded header', () => {
    expect(clientIp(req({}, '9.9.9.9'))).toBe('9.9.9.9')
  })

  it('normalizes forwarded IPv4-mapped IPv6 addresses', () => {
    expect(clientIp(req({ 'x-forwarded-for': '::ffff:203.0.113.7' }, '9.9.9.9'))).toBe(
      '203.0.113.7',
    )
  })

  it('returns null when nothing is available', () => {
    expect(clientIp(req({}, undefined))).toBeNull()
  })
})
