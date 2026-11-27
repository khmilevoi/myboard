import { atom, context, wrap } from '@reatom/core'
import { defaultCatProfile } from 'module-cats/domain/cat'
import { catWeightKey } from 'module-cats/domain/keys'
import { makeTestCatsModel } from 'module-cats/testing'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { makeWeightHistory } from './weight-history'

const TODAY = '2026-11-26'

const WEIGHINGS = [
  { at: '2026-09-15', kg: 4.42, createdBy: { accountId: 'a', name: 'Леша' } },
  { at: '2026-10-01', kg: 4.4, createdBy: { accountId: 'k', name: 'Карина' } },
  { at: '2026-10-14', kg: 4.41, createdBy: { accountId: 'a', name: 'Леша' } },
  { at: '2026-10-27', kg: 4.38, createdBy: { accountId: 'a', name: 'Леша' } },
  { at: '2026-11-07', kg: 4.35, createdBy: { accountId: 'k', name: 'Карина' } },
  { at: '2026-11-21', kg: 4.32, createdBy: { accountId: 'a', name: 'Леша' } },
].map((weighing, index) => ({ id: `w${index}`, ts: index + 1, ...weighing }))

afterEach(() => {
  context.reset()
})

function setup(weighings: unknown[] = WEIGHINGS) {
  const shared = createFakeStorage()
  void shared.set(catWeightKey('ofelia'), weighings)
  const { model } = makeTestCatsModel({
    todayIso: TODAY,
    storage: shared,
    catRegistry: [{ id: 'c1', ts: 1, catId: 'ofelia', op: 'add' }],
    litterRegistry: [{ id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' }],
    profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') },
  })
  const cat = atom(model.cat('ofelia'), 'test.cat')
  const today = atom<Temporal.PlainDate | null>(Temporal.PlainDate.from(TODAY), 'test.today')
  const members = atom(new Map(), 'test.members')
  const history = makeWeightHistory(cat, today, members, 'test.history')
  // Subscribe so the lazy storage read runs.
  history.rows.subscribe(() => {})
  history.points.subscribe(() => {})
  return history
}

const ats = (history: ReturnType<typeof setup>) => history.points().map((point) => point.at)

describe('makeWeightHistory', () => {
  it('defaults to the quarter, which keeps all six weighings oldest first', async () => {
    const history = setup()
    await expect.poll(() => history.points().length).toBe(6)
    expect(history.range()).toBe('quarter')
    expect(ats(history)[0]).toBe('2026-09-15')
    expect(ats(history).at(-1)).toBe('2026-11-21')
  })

  it('the month keeps 21 ноя and 7 ноя: the range excludes its first day', async () => {
    const history = setup()
    await expect.poll(() => history.points().length).toBe(6)
    wrap(() => history.range.set('month'))()
    // 2026-10-27 is exactly today - 30 days and is left out.
    expect(ats(history)).toEqual(['2026-11-07', '2026-11-21'])
  })

  it('the year keeps everything', async () => {
    const history = setup()
    await expect.poll(() => history.points().length).toBe(6)
    wrap(() => history.range.set('year'))()
    expect(history.points()).toHaveLength(6)
  })

  it('rows cover all weighings, newest first, with the delta to the next older one', async () => {
    const history = setup()
    await expect.poll(() => history.rows().length).toBe(6)
    const rows = history.rows()
    expect(rows[0].at).toBe('2026-11-21')
    expect(rows[0].deltaGrams).toBe(-30)
    expect(rows[2].deltaGrams).toBe(-30)
    expect(rows[3].deltaGrams).toBe(10)
    expect(rows.at(-1)?.deltaGrams).toBeNull()
    expect(rows[0].author).toMatchObject({ kind: 'account', name: 'Леша' })
    expect(rows[1].author).toMatchObject({ kind: 'account', name: 'Карина' })
  })

  it('a row without an author is an unknown author', async () => {
    const history = setup([{ id: 'w1', ts: 1, at: '2026-11-21', kg: 4.32 }])
    await expect.poll(() => history.rows().length).toBe(1)
    expect(history.rows()[0].author).toEqual({ kind: 'unknown' })
  })

  it('the axis pads the extremes by 0.05 kg and labels the month starts and the latest day', async () => {
    const history = setup()
    await expect.poll(() => history.points().length).toBe(6)
    const axis = history.axis()
    expect(axis.minKg).toBe(4.27)
    expect(axis.maxKg).toBe(4.47)
    expect(axis.months.map((month) => month.label)).toEqual(['1 СЕН', '1 ОКТ', '1 НОЯ', '21 НОЯ'])
    expect(axis.months.map((month) => month.at)).toEqual([
      '2026-09-01',
      '2026-10-01',
      '2026-11-01',
      '2026-11-21',
    ])
  })

  it('the year thins its month labels to every second one, and keeps the latest day', async () => {
    // One weighing on the 10th of every month from December 2025 to November 2026.
    const monthly = Array.from({ length: 12 }, (_, index) => {
      const at = Temporal.PlainDate.from('2025-12-10').add({ months: index }).toString()
      return { id: `m${index}`, ts: index + 1, at, kg: 4.3 }
    })
    const history = setup(monthly)
    await expect.poll(() => history.points().length).toBe(3)
    wrap(() => history.range.set('year'))()
    await expect.poll(() => history.points().length).toBe(12)

    expect(history.axis().months.map((month) => month.label)).toEqual([
      '1 ДЕК',
      '1 ФЕВ',
      '1 АПР',
      '1 ИЮН',
      '1 АВГ',
      '1 ОКТ',
      '10 НОЯ',
    ])
  })

  it('a quarter keeps every month label', async () => {
    const history = setup()
    await expect.poll(() => history.points().length).toBe(6)
    expect(history.axis().months).toHaveLength(4)
  })

  it('no weighings: empty points, rows and axis', () => {
    const history = setup([])
    expect(history.points()).toEqual([])
    expect(history.rows()).toEqual([])
    expect(history.axis().months).toEqual([])
  })
})
