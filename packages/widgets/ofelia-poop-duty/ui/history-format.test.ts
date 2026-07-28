// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { HistoryEntryView } from '@/model/history-view'

import { describeEntry, formatDutyDay, formatTimeOfDay, formatWeekdayShort } from './history-format'

const view = (o: Partial<HistoryEntryView> = {}): HistoryEntryView => ({
  id: 'e1',
  type: 'cleaned',
  actor: 'Леша',
  dutyDate: '2026-06-16',
  recordedAt: 0,
  recordedBy: { kind: 'unknown' },
  isViewerRecord: false,
  recordedLate: false,
  debtDelta: null,
  ...o,
})

describe('formatDutyDay', () => {
  it('says сегодня for the current duty day', () => {
    expect(formatDutyDay('2026-06-16', '2026-06-16')).toBe('сегодня')
  })

  it('says вчера for the day before', () => {
    expect(formatDutyDay('2026-06-15', '2026-06-16')).toBe('вчера')
  })

  it('falls back to a day and month', () => {
    expect(formatDutyDay('2026-06-12', '2026-06-16')).toBe('12 июня')
  })

  it('falls back to a day and month when today is unknown', () => {
    expect(formatDutyDay('2026-06-16', null)).toBe('16 июня')
  })
})

describe('formatWeekdayShort', () => {
  it('is the lowercase two-letter weekday', () => {
    expect(formatWeekdayShort('2026-06-16')).toBe('вт')
  })
})

describe('formatTimeOfDay', () => {
  it('is zero-padded 24-hour local time in the duty time zone', () => {
    // 2026-06-16 21:40 Europe/Warsaw
    expect(formatTimeOfDay(Date.UTC(2026, 5, 16, 19, 40))).toBe('21:40')
  })
})

describe('describeEntry', () => {
  it('describes a plain cleaned day', () => {
    expect(describeEntry(view())).toEqual({ parts: [{ person: 'Леша' }, ' убрал(а)'] })
  })

  it('describes cleaning on behalf of someone', () => {
    expect(describeEntry(view({ onBehalfOf: 'Карина' }))).toEqual({
      parts: [{ person: 'Леша' }, ' убрал(а) за ', { person: 'Карина' }],
    })
  })

  it('describes going into debt', () => {
    expect(
      describeEntry(view({ type: 'went_into_debt', actor: 'Леша', onBehalfOf: 'Карина' })),
    ).toEqual({
      parts: [{ person: 'Карина' }, ' ушёл(ла) в долг → убирает ', { person: 'Леша' }],
    })
  })

  it('describes forgiveness', () => {
    expect(describeEntry(view({ type: 'forgiven', actor: 'Леша', onBehalfOf: 'Карина' }))).toEqual({
      parts: [{ person: 'Леша' }, ' простил(а) день ', { person: 'Карина' }],
    })
  })

  it('never names a person on a reset', () => {
    expect(describeEntry(view({ type: 'reset', actor: 'Леша' }))).toEqual({
      parts: ['день переоткрыт'],
    })
  })
})
