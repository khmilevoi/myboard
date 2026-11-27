import { describe, expect, it } from 'vitest'

import { formatGenitiveNumeral, pluralize } from './ru-count'

describe('pluralize', () => {
  const forms = ['устройство', 'устройства', 'устройств'] as const
  it.each([
    [1, 'устройство'],
    [2, 'устройства'],
    [5, 'устройств'],
    [11, 'устройств'],
    [21, 'устройство'],
    [112, 'устройств'],
  ])('%i -> %s', (count, expected) => {
    expect(pluralize(count, ...forms)).toBe(expected)
  })
})

describe('formatGenitiveNumeral', () => {
  it.each([
    [1, 'одного'],
    [2, 'двух'],
    [3, 'трёх'],
    [4, 'четырёх'],
    [8, 'восьми'],
    [11, 'одиннадцати'],
    [12, 'двенадцати'],
    [19, 'девятнадцати'],
    [20, 'двадцати'],
    [21, '21'],
  ])('%i -> %s', (count, expected) => {
    expect(formatGenitiveNumeral(count)).toBe(expected)
  })
})
