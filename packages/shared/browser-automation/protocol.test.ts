import { describe, expect, it } from 'vitest'

import { HealthResponseSchema, TaskRequestSchema, TaskResponseSchema } from './protocol'

describe('browser automation protocol', () => {
  it('accepts requests with and without payloads', () => {
    expect(TaskRequestSchema.safeParse({ payload: { value: 1 } }).success).toBe(true)
    expect(TaskRequestSchema.safeParse({}).success).toBe(true)
  })

  it('accepts success and public error envelopes', () => {
    expect(TaskResponseSchema.safeParse({ ok: true, result: { value: 1 } }).success).toBe(true)
    expect(
      TaskResponseSchema.safeParse({
        ok: false,
        error: {
          code: 'automation_timeout',
          message: 'The browser task timed out',
          meta: { phase: 'queue' },
        },
      }).success,
    ).toBe(true)
  })

  it('rejects mixed and incomplete envelopes', () => {
    expect(
      TaskResponseSchema.safeParse({ ok: true, error: { code: 'x', message: 'y' } }).success,
    ).toBe(false)
    expect(TaskResponseSchema.safeParse({ ok: false, error: { code: 'x' } }).success).toBe(false)
  })

  it('accepts only known health states', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ready' }).success).toBe(true)
    expect(HealthResponseSchema.safeParse({ status: 'unknown' }).success).toBe(false)
  })
})
