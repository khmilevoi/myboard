import { describe, expect, it } from 'vitest'

import { BrowserTaskError } from './task-errors'

class ProbeTaskError extends BrowserTaskError {
  code = 'probe'
  publicMessage = 'Probe failed'
  get publicMeta(): Record<string, unknown> {
    return { safe: true }
  }
}

describe('BrowserTaskError', () => {
  it('provides safe internal defaults and supports widget-owned subclasses', () => {
    const base = new BrowserTaskError('raw internal detail')
    const probe = new ProbeTaskError('raw probe detail')

    expect(base).toBeInstanceOf(Error)
    expect(base.code).toBe('internal')
    expect(base.publicMessage).toBe('Browser task failed')
    expect(base.publicMeta).toBeUndefined()
    expect(probe).toMatchObject({ code: 'probe', publicMessage: 'Probe failed' })
    expect(probe.publicMeta).toEqual({ safe: true })
  })
})
