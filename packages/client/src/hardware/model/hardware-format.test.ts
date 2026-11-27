import { formatGenitiveNumeral } from '@shared/format/ru-count'
import { SCALE_USER_SLOTS } from '@shared/hardware/spike-assumptions'
import { describe, expect, it } from 'vitest'

import {
  formatAge,
  formatAgo,
  formatBattery,
  formatLastReading,
  formatScaleProfileSummary,
  formatSignal,
  formatSlotsFull,
  formatSlotsUpTo,
} from './hardware-format'

// Local time on purpose: "today" and the clock are the viewer's local calendar.
const NOW = new Date(2026, 10, 26, 9, 30).getTime()
const TODAY_0812 = new Date(2026, 10, 26, 8, 12).getTime()
const YESTERDAY_2140 = new Date(2026, 10, 25, 21, 40).getTime()
const NOV_24_0758 = new Date(2026, 10, 24, 7, 58).getTime()

describe('formatAgo', () => {
  it('uses the Decision 14 tiers', () => {
    expect(formatAgo(NOW - 59_000, NOW)).toBe('только что')
    expect(formatAgo(NOW - 2 * 60_000, NOW)).toBe('2 мин назад')
    expect(formatAgo(NOW - 3 * 3_600_000, NOW)).toBe('3 ч назад')
    expect(formatAgo(NOV_24_0758, NOW)).toBe('24 нояб.')
  })

  it('treats a future timestamp as just now', () => {
    expect(formatAgo(NOW + 5_000, NOW)).toBe('только что')
  })
})

describe('formatLastReading', () => {
  it('says when the last weighing was', () => {
    expect(formatLastReading(TODAY_0812, NOW)).toBe('взвешивание сегодня, 08:12')
    expect(formatLastReading(YESTERDAY_2140, NOW)).toBe('взвешивание вчера, 21:40')
    expect(formatLastReading(NOV_24_0758, NOW)).toBe('взвешивание 24 нояб., 07:58')
    expect(formatLastReading(null, NOW)).toBe('взвешиваний ещё не было')
  })
})

describe('formatBattery', () => {
  it('prints the percent', () => {
    expect(formatBattery(80)).toBe('батарея 80%')
  })
})

describe('formatSignal', () => {
  it('buckets RSSI', () => {
    expect(formatSignal(-70)).toBe('сигнал хороший')
    expect(formatSignal(-71)).toBe('сигнал средний')
    expect(formatSignal(-85)).toBe('сигнал средний')
    expect(formatSignal(-86)).toBe('сигнал слабый')
  })
})

describe('formatAge', () => {
  it('counts whole years with the right plural', () => {
    const today = { year: 2026, month: 11, day: 26 } as Temporal.PlainDate
    expect(formatAge('1992-03-01', today)).toBe('34 года')
    expect(formatAge('1992-11-27', today)).toBe('33 года')
    expect(formatAge('1992-11-26', today)).toBe('34 года')
    expect(formatAge('2005-01-01', today)).toBe('21 год')
    expect(formatAge('2000-01-01', today)).toBe('26 лет')
  })
})

describe('formatScaleProfileSummary', () => {
  it('joins height, age and sex', () => {
    const today = { year: 2026, month: 11, day: 26 } as Temporal.PlainDate
    expect(
      formatScaleProfileSummary({ heightCm: 182, birthDate: '1992-03-01', sex: 'male' }, today),
    ).toBe('рост 182 см · 34 года · мужской')
    expect(
      formatScaleProfileSummary({ heightCm: 165, birthDate: '1992-03-01', sex: 'female' }, today),
    ).toBe('рост 165 см · 34 года · женский')
  })
})

describe('slot copy', () => {
  it('builds the genitive "up to" line from the constant', () => {
    expect(formatSlotsUpTo()).toContain(formatGenitiveNumeral(SCALE_USER_SLOTS))
    expect(formatSlotsUpTo().startsWith('До ')).toBe(true)
    if (SCALE_USER_SLOTS === 8) expect(formatSlotsUpTo()).toBe('До восьми профилей')
  })

  it('builds the "all taken" line from the constant', () => {
    expect(formatSlotsFull()).toContain(String(SCALE_USER_SLOTS))
    if (SCALE_USER_SLOTS === 8) expect(formatSlotsFull()).toBe('на весах заняты все 8 профилей')
  })
})
