import { describe, expect, it } from 'vitest'

import {
  formatAge,
  formatDayMonth,
  formatDaysAgo,
  formatGrams,
  formatKg,
  sexLabel,
  sterilizedLabel,
} from './format'

const D = (iso: string) => Temporal.PlainDate.from(iso)

describe('formatKg', () => {
  it('prints two decimals with the decimal comma', () => {
    expect(formatKg(4.32)).toBe('4,32 кг')
    expect(formatKg(4.3)).toBe('4,30 кг')
  })
})

describe('formatGrams', () => {
  it('signs the delta, with U+2212 for minus', () => {
    expect(formatGrams(-80)).toBe('−80 г')
    expect(formatGrams(260)).toBe('+260 г')
    expect(formatGrams(0)).toBe('0 г')
  })

  it('rounds to whole grams', () => {
    expect(formatGrams(-19.6)).toBe('−20 г')
  })
})

describe('formatAge', () => {
  const today = D('2026-11-26')

  it('prints years and months in the long form', () => {
    expect(formatAge(D('2023-09-10'), today, 'long')).toBe('3 года 2 мес')
  })

  it('drops the months in the short form', () => {
    expect(formatAge(D('2023-09-10'), today, 'short')).toBe('3 года')
  })

  it('prints whole years without months', () => {
    expect(formatAge(D('2023-11-26'), today, 'long')).toBe('3 года')
  })

  it('prints months alone under a year, in both forms', () => {
    expect(formatAge(D('2026-03-15'), today, 'long')).toBe('8 мес')
    expect(formatAge(D('2026-03-15'), today, 'short')).toBe('8 мес')
  })

  it('declines the years', () => {
    expect(formatAge(D('2025-11-26'), today, 'short')).toBe('1 год')
    expect(formatAge(D('2021-11-26'), today, 'short')).toBe('5 лет')
  })

  it('is null for a birth date after today', () => {
    expect(formatAge(D('2026-12-01'), today, 'long')).toBeNull()
  })
})

describe('formatDaysAgo', () => {
  it.each([
    [0, 'сегодня'],
    [1, 'вчера'],
    [2, '2 дня назад'],
    [5, '5 дней назад'],
    [21, '21 день назад'],
  ])('%i → %s', (days, text) => {
    expect(formatDaysAgo(days)).toBe(text)
  })
})

describe('formatDayMonth', () => {
  it('prints the day and the genitive month', () => {
    expect(formatDayMonth(D('2026-11-21'))).toBe('21 ноября')
  })
})

describe('sexLabel', () => {
  it('names the sex', () => {
    expect(sexLabel('female')).toBe('кошка')
    expect(sexLabel('male')).toBe('кот')
    expect(sexLabel(null)).toBeNull()
  })
})

describe('sterilizedLabel', () => {
  it('agrees with the sex, feminine by default', () => {
    expect(sterilizedLabel('yes', 'female')).toBe('стерилизована')
    expect(sterilizedLabel('yes', 'male')).toBe('стерилизован')
    expect(sterilizedLabel('yes', null)).toBe('стерилизована')
    expect(sterilizedLabel('no', 'female')).toBe('не стерилизована')
    expect(sterilizedLabel('no', 'male')).toBe('не стерилизован')
  })

  it('is null when unknown', () => {
    expect(sterilizedLabel('unknown', 'female')).toBeNull()
  })
})
