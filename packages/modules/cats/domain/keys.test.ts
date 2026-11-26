import { describe, expect, it } from 'vitest'

import { commentsKey, dutyKey, LEDGER_KEY } from './keys'

describe('duty keys', () => {
  it('namespaces every relative key under duty/', () => {
    expect(dutyKey('x')).toBe('duty/x')
    expect(LEDGER_KEY).toBe('duty/ledger')
  })

  it('derives the per-week comments key', () => {
    expect(commentsKey('2026-06-15')).toBe('duty/comments:2026-06-15')
  })
})
