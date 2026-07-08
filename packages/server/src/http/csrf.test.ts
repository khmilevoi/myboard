import { describe, expect, it } from 'vitest'

import { csrfBlocked } from './csrf'

const req = (method: string, url: string, header?: string) => ({
  method,
  url,
  headers: header === undefined ? {} : { 'x-requested-with': header },
})

describe('csrfBlocked', () => {
  it('blocks mutating /api requests without the header', () => {
    expect(csrfBlocked(req('POST', '/api/storage/k/append'))).toBe(true)
    expect(csrfBlocked(req('PUT', '/api/storage/k'))).toBe(true)
    expect(csrfBlocked(req('DELETE', '/api/storage/k'))).toBe(true)
    expect(csrfBlocked(req('POST', '/api/auth/logout'))).toBe(true)
  })

  it('passes mutating /api requests with the exact header', () => {
    expect(csrfBlocked(req('POST', '/api/storage/k/append', 'MyBoard'))).toBe(false)
    expect(csrfBlocked(req('PUT', '/api/storage/k', 'MyBoard'))).toBe(false)
  })

  it('rejects a wrong header value', () => {
    expect(csrfBlocked(req('POST', '/api/auth/logout', 'Other'))).toBe(true)
  })

  it('ignores reads and non-api paths', () => {
    expect(csrfBlocked(req('GET', '/api/storage/k'))).toBe(false)
    expect(csrfBlocked(req('HEAD', '/api/storage/k'))).toBe(false)
    expect(csrfBlocked(req('POST', '/healthz'))).toBe(false)
  })

  it('exempts /api/test/*', () => {
    expect(csrfBlocked(req('POST', '/api/test/reset'))).toBe(false)
    expect(csrfBlocked(req('POST', '/api/test/seed-invite'))).toBe(false)
  })
})
