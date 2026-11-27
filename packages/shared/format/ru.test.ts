import { describe, expect, it } from 'vitest'

import { formatDecimalRu, MONTHS_GENITIVE, MONTHS_SHORT, pluralRu } from './ru'

describe('pluralRu', () => {
  const days = (count: number) => pluralRu(count, 'день', 'дня', 'дней')

  it('takes the "one" form for 1, 21 and 101', () => {
    for (const count of [1, 21, 101]) expect(days(count)).toBe('день')
  })

  it('takes the "few" form for 2, 4 and 22', () => {
    for (const count of [2, 4, 22]) expect(days(count)).toBe('дня')
  })

  it('takes the "many" form for 0, 5, the teens and 111, 112', () => {
    for (const count of [0, 5, 11, 14, 111, 112]) expect(days(count)).toBe('дней')
  })
})

describe('formatDecimalRu', () => {
  it('pads to the given digits and writes a decimal comma', () => {
    expect(formatDecimalRu(4.3, 2)).toBe('4,30')
    expect(formatDecimalRu(4.32, 2)).toBe('4,32')
    expect(formatDecimalRu(0.5, 1)).toBe('0,5')
  })
})

describe('month names', () => {
  it('spells the genitive months from января to декабря', () => {
    expect(MONTHS_GENITIVE).toHaveLength(12)
    expect(MONTHS_GENITIVE[0]).toBe('января')
    expect(MONTHS_GENITIVE[11]).toBe('декабря')
  })

  it('abbreviates the months for chart axes', () => {
    expect(MONTHS_SHORT).toEqual([
      'янв',
      'фев',
      'мар',
      'апр',
      'мая',
      'июн',
      'июл',
      'авг',
      'сен',
      'окт',
      'ноя',
      'дек',
    ])
    expect(MONTHS_SHORT[10]).toBe('ноя')
  })
})
