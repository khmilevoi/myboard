import { describe, expect, it, vi } from 'vitest'

import {
  CatRegistryEventsSchema,
  foldCatRegistry,
  foldLitterRegistry,
  type CatRegistryEvent,
  type LitterRegistryEvent,
} from './registry'

let seq = 0
const cat = (op: CatRegistryEvent['op'], catId: string, ts = ++seq): CatRegistryEvent => ({
  id: `c${ts}`,
  ts,
  catId,
  op,
})
const litter = (litterId: string, ts = ++seq): LitterRegistryEvent => ({
  id: `l${ts}`,
  ts,
  litterId,
  op: 'add',
})

describe('foldCatRegistry', () => {
  it('lists every known cat in first-add order, archived ones included', () => {
    const folded = foldCatRegistry([
      cat('add', 'a', 10),
      cat('add', 'b', 20),
      cat('archive', 'a', 30),
    ])

    expect(folded.order).toEqual(['a', 'b'])
  })

  it('moves an archived cat out of active, stamped with the archive ts', () => {
    const archive = cat('archive', 'a', 30)

    expect(foldCatRegistry([cat('add', 'a', 10), cat('add', 'b', 20), archive])).toEqual({
      order: ['a', 'b'],
      active: ['b'],
      archived: [{ catId: 'a', archivedAt: 30 }],
    })
  })

  it('ignores archiving the only active cat', () => {
    expect(foldCatRegistry([cat('add', 'a'), cat('archive', 'a')])).toEqual({
      order: ['a'],
      active: ['a'],
      archived: [],
    })
  })

  it('keeps one cat active when the last two are archived together', () => {
    const events = [cat('add', 'a'), cat('add', 'b'), cat('archive', 'a'), cat('archive', 'b')]

    expect(foldCatRegistry(events)).toEqual({
      order: ['a', 'b'],
      active: ['b'],
      archived: [{ catId: 'a', archivedAt: events[2].ts }],
    })
  })

  it('restores an archived cat to its original position', () => {
    const events = [
      cat('add', 'a'),
      cat('add', 'b'),
      cat('add', 'c'),
      cat('archive', 'a'),
      cat('restore', 'a'),
    ]

    expect(foldCatRegistry(events)).toEqual({
      order: ['a', 'b', 'c'],
      active: ['a', 'b', 'c'],
      archived: [],
    })
  })

  it('ignores a duplicate add', () => {
    expect(foldCatRegistry([cat('add', 'a'), cat('add', 'b'), cat('add', 'a')])).toEqual({
      order: ['a', 'b'],
      active: ['a', 'b'],
      archived: [],
    })
  })

  it('ignores a restore of an active cat and an archive of an archived one', () => {
    const events = [
      cat('add', 'a'),
      cat('add', 'b'),
      cat('add', 'c'),
      cat('restore', 'a'),
      cat('archive', 'b'),
      cat('archive', 'b'),
    ]

    expect(foldCatRegistry(events)).toEqual({
      order: ['a', 'b', 'c'],
      active: ['a', 'c'],
      archived: [{ catId: 'b', archivedAt: events[4].ts }],
    })
  })

  it('applies events in ts order, not storage order', () => {
    expect(foldCatRegistry([cat('add', 'b', 2), cat('add', 'a', 1)]).active).toEqual(['a', 'b'])
  })
})

describe('CatRegistryEventsSchema', () => {
  it('drops an invalid element instead of failing the array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const valid = cat('add', 'a')

    expect(
      CatRegistryEventsSchema.parse([valid, { ...valid, catId: 'Bad/Id' }, { op: 'add' }]),
    ).toEqual([valid])
    expect(warn).toHaveBeenCalledTimes(2)
    warn.mockRestore()
  })
})

describe('foldLitterRegistry', () => {
  it('dedupes and keeps add order', () => {
    expect(foldLitterRegistry([litter('a'), litter('b'), litter('a'), litter('c')])).toEqual([
      'a',
      'b',
      'c',
    ])
  })
})
