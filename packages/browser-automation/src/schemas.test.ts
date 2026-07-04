import { describe, expect, it } from 'vitest'

import { HealthResponseSchema, TaskRequestSchema, TaskResponseSchema } from './schemas'

describe('wire schemas', () => {
  it('accepts a request with a payload and a request with none', () => {
    expect(TaskRequestSchema.safeParse({ payload: { a: 1 } }).success).toBe(true)
    expect(TaskRequestSchema.safeParse({}).success).toBe(true)
  })

  it('parses a success envelope', () => {
    expect(TaskResponseSchema.safeParse({ ok: true, result: { x: 1 } }).success).toBe(true)
  })

  it('parses an error envelope with optional meta', () => {
    expect(
      TaskResponseSchema.safeParse({
        ok: false,
        error: { code: 'automation_timeout', message: 'x', meta: { phase: 'queue' } },
      }).success,
    ).toBe(true)
  })

  it('rejects a mixed envelope', () => {
    expect(
      TaskResponseSchema.safeParse({ ok: true, error: { code: 'x', message: 'y' } }).success,
    ).toBe(false)
  })

  it('parses a health response', () => {
    expect(HealthResponseSchema.safeParse({ status: 'ready' }).success).toBe(true)
    expect(HealthResponseSchema.safeParse({ status: 'nope' }).success).toBe(false)
  })
})
