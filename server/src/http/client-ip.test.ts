import type { IncomingMessage } from 'node:http'

import { describe, expect, it } from 'vitest'

import { clientIp } from './client-ip'

function req(headers: IncomingMessage['headers'], remoteAddress?: string): IncomingMessage {
  return { headers, socket: { remoteAddress } } as unknown as IncomingMessage
}

describe('clientIp', () => {
  it('takes the first hop of a comma-separated x-forwarded-for', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' }, '9.9.9.9'))).toBe('1.1.1.1')
  })

  it('takes the first entry when x-forwarded-for is an array', () => {
    expect(clientIp(req({ 'x-forwarded-for': ['3.3.3.3, 4.4.4.4', '5.5.5.5'] }, '9.9.9.9'))).toBe(
      '3.3.3.3',
    )
  })

  it('falls back to socket.remoteAddress when no forwarded header', () => {
    expect(clientIp(req({}, '9.9.9.9'))).toBe('9.9.9.9')
  })

  it('returns null when nothing is available', () => {
    expect(clientIp(req({}, undefined))).toBeNull()
  })
})
