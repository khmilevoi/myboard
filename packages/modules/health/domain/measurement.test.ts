import { describe, expect, it } from 'vitest'

import { MeasurementSchema } from './measurement'

const valid = {
  id: 'hw1:1:1700000000',
  takenAt: 1_700_000_000_000,
  metrics: { weight: { value: 72.5, unit: 'kg' } },
  source: { kind: 'hardware', hardwareId: 'hw1', model: 'scale-x' },
}

describe('MeasurementSchema', () => {
  it('parses a valid reading', () => {
    expect(MeasurementSchema.parse(valid)).toEqual(valid)
  })

  it('rejects a wrong unit', () => {
    const r = MeasurementSchema.safeParse({
      ...valid,
      metrics: { weight: { value: 160, unit: 'lb' } },
    })
    expect(r.success).toBe(false)
  })

  it('rejects empty metrics', () => {
    expect(MeasurementSchema.safeParse({ ...valid, metrics: {} }).success).toBe(false)
  })

  it('rejects NaN values', () => {
    const r = MeasurementSchema.safeParse({
      ...valid,
      metrics: { weight: { value: NaN, unit: 'kg' } },
    })
    expect(r.success).toBe(false)
  })

  it('rejects negative takenAt', () => {
    expect(MeasurementSchema.safeParse({ ...valid, takenAt: -1 }).success).toBe(false)
  })

  it('strips extra fields', () => {
    const parsed = MeasurementSchema.parse({ ...valid, ts: 5, ip: '1.2.3.4' })
    expect(parsed).toEqual(valid)
  })
})
