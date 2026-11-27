import { describe, expect, it } from 'vitest'

import type { Measurement } from './measurement'
import { mergeSeries } from './series'

const source = { kind: 'hardware', hardwareId: 'h', model: 'm' } as const
const w = (id: string, takenAt: number): Measurement => ({
  id,
  takenAt,
  metrics: { weight: { value: 70, unit: 'kg' } },
  source,
})

describe('mergeSeries', () => {
  it('dedupes by id across ledgers', () => {
    expect(mergeSeries([[w('a', 1)], [w('a', 1), w('b', 2)]]).map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('sorts out-of-order input by takenAt then id', () => {
    expect(mergeSeries([[w('c', 3), w('b', 1), w('a', 1)]]).map((m) => m.id)).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('keeps only records with the kind', () => {
    const fat: Measurement = {
      id: 'f',
      takenAt: 5,
      metrics: { 'body-fat': { value: 20, unit: '%' } },
      source,
    }
    expect(mergeSeries([[w('a', 1), fat]], 'weight').map((m) => m.id)).toEqual(['a'])
  })
})
