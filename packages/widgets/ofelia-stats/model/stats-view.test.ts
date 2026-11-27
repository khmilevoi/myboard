import { context, wrap } from '@reatom/core'
import { defaultCatProfile } from 'module-cats/domain/cat'
import { CARD_LITTER_KEY, ledgerKey } from 'module-cats/domain/keys'
import type { LedgerEntry } from 'module-cats/domain/ledger'
import type { CatRegistryEvent, LitterRegistryEvent } from 'module-cats/domain/registry'
import { makeTestCatsModel } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WidgetModules } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { makeStatsView } from './stats-view'

const TODAY = '2026-06-16'

const catEvent = (catId: string, ts: number): CatRegistryEvent => ({
  id: `c${ts}`,
  ts,
  catId,
  op: 'add',
})
const litterEvent = (litterId: string, ts: number): LitterRegistryEvent => ({
  id: `l${ts}`,
  ts,
  litterId,
  op: 'add',
})
const cleaned = (id: string, date: string, actor: LedgerEntry['actor']): LedgerEntry => ({
  id,
  ts: 1,
  date,
  type: 'cleaned',
  actor,
})

afterEach(() => {
  context.reset()
})

function setup(stored: string | null) {
  const shared = createFakeStorage()
  void shared.set(ledgerKey('ofelia'), [cleaned('o1', TODAY, 'Леша')])
  void shared.set(ledgerKey('busya'), [
    cleaned('b1', TODAY, 'Карина'),
    cleaned('b2', '2026-06-15', 'Карина'),
  ])
  const { model } = makeTestCatsModel({
    storage: shared,
    todayIso: TODAY,
    catRegistry: [catEvent('ofelia', 1), catEvent('busya', 2)],
    litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
    profiles: {
      ofelia: defaultCatProfile('Офелия', 'ofelia'),
      busya: defaultCatProfile('Буся', 'busya'),
    },
  })
  const instance = createFakeStorage()
  if (stored !== null) void instance.set(CARD_LITTER_KEY, stored)
  const modules = { get: async () => model } as unknown as WidgetModules
  return makeStatsView({ modules, storage: instance })
}

describe('makeStatsView', () => {
  it('maps the chosen litter’s member statistics to rows', async () => {
    const view = setup('busya')

    await context.start(async () => {
      const off = view.rows.subscribe(() => {})
      const read = wrap(() => view.rows())
      await vi.waitFor(() => expect(read()).not.toBeNull())
      // Only `busya`'s ledger has two cleanings by Карина; `ofelia`'s has one by Леша.
      expect(read()?.map(({ person, cleanings }) => [person, cleanings])).toEqual(
        expect.arrayContaining([
          ['Леша', 0],
          ['Карина', 2],
        ]),
      )
      off()
    })
  })

  it('falls back to the first offered litter with nothing stored', async () => {
    const view = setup(null)

    await context.start(async () => {
      const off = view.rows.subscribe(() => {})
      const read = wrap(() => view.rows())
      await vi.waitFor(() => expect(read()).not.toBeNull())
      expect(read()?.find((row) => row.person === 'Леша')?.cleanings).toBe(1)
      off()
    })
  })

  it('reports no litter when nothing is offered', async () => {
    const { model } = makeTestCatsModel({ todayIso: TODAY, catRegistry: [], litterRegistry: [] })
    const modules = { get: async () => model } as unknown as WidgetModules
    const view = makeStatsView({ modules, storage: createFakeStorage() })

    await context.start(async () => {
      const off = view.empty.subscribe(() => {})
      const read = wrap(() => view.empty())
      await vi.waitFor(() => expect(read()).toBe(true))
      expect(wrap(() => view.rows())()).toBeNull()
      off()
    })
  })
})
