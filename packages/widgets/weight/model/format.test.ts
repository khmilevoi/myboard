import { describe, expect, it } from 'vitest'

import {
  formatChange,
  formatDelta,
  formatKg,
  formatTakenAt,
  formatTakenAtFull,
  formatTakenOn,
  formatTick,
} from './format'

// Local time on purpose: "today" and the clock are the viewer's local calendar.
const NOW = new Date(2026, 10, 26, 9, 30).getTime()
const TODAY_0812 = new Date(2026, 10, 26, 8, 12).getTime()
const NOV_24_0758 = new Date(2026, 10, 24, 7, 58).getTime()

describe('formatKg', () => {
  it('prints one decimal with a comma and the unit', () => {
    expect(formatKg(83)).toBe('83,0 кг')
    expect(formatKg(83.27)).toBe('83,3 кг')
    expect(formatKg(104.04)).toBe('104,0 кг')
  })
})

describe('formatDelta', () => {
  it('signs a loss with a true minus and a gain with a plus', () => {
    expect(formatDelta(-1.2)).toBe('−1,2 кг')
    expect(formatDelta(0.4)).toBe('+0,4 кг')
  })

  it('never prints a signed zero', () => {
    expect(formatDelta(0)).toBe('0,0 кг')
    expect(formatDelta(-0.04)).toBe('0,0 кг')
    expect(formatDelta(0.04)).toBe('0,0 кг')
  })

  it('absorbs floating-point noise from a subtraction', () => {
    expect(formatDelta(83 - 84.4)).toBe('−1,4 кг')
  })
})

describe('formatChange', () => {
  it('signs the list column without a unit', () => {
    expect(formatChange(-0.3)).toBe('−0,3')
    expect(formatChange(0.1)).toBe('+0,1')
    expect(formatChange(0)).toBe('0,0')
    expect(formatChange(-0.04)).toBe('0,0')
  })
})

describe('formatTakenAt', () => {
  it('shows the time for a reading taken today', () => {
    expect(formatTakenAt(TODAY_0812, NOW)).toBe('сегодня, 08:12')
  })

  it('shows only the date for an earlier day', () => {
    expect(formatTakenAt(NOV_24_0758, NOW)).toBe('24 нояб.')
  })
})

describe('formatTakenAtFull', () => {
  it('always carries the time', () => {
    expect(formatTakenAtFull(TODAY_0812, NOW)).toBe('сегодня, 08:12')
    expect(formatTakenAtFull(NOV_24_0758, NOW)).toBe('24 нояб., 07:58')
  })
})

describe('formatTakenOn', () => {
  it('is the date alone', () => {
    expect(formatTakenOn(TODAY_0812, NOW)).toBe('сегодня')
    expect(formatTakenOn(NOV_24_0758, NOW)).toBe('24 нояб.')
  })
})

describe('formatTick', () => {
  it('drops the abbreviation dot for axis labels', () => {
    expect(formatTick(TODAY_0812, NOW)).toBe('сегодня')
    expect(formatTick(NOV_24_0758, NOW)).toBe('24 нояб')
    expect(formatTick(new Date(2026, 4, 4).getTime(), NOW)).toBe('4 мая')
  })
})
