import { CatProfileSchema } from '@modules/cats/domain/cat'
import { LedgerEntriesSchema, resolveDays } from '@modules/cats/domain/ledger'
import { CatRegistryEventsSchema, LitterRegistryEventsSchema } from '@modules/cats/domain/registry'
import { LitterSettingsSchema } from '@modules/cats/domain/roster'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { makeModuleServerStorage } from '../modules/api'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { ofeliaToCatsMigration } from './ofelia-to-cats'

const makeOps = () => createMemoryOps(createMemoryPubSub())
const rec = (id: string, ts: number) => ({ id, ts, text: id })

const seeds = {
  'm:cats:s:registry/cats': '[{"id":"seed:ofelia","ts":0,"catId":"ofelia","op":"add"}]',
  'm:cats:s:registry/litters': '[{"id":"seed:ofelia","ts":0,"litterId":"ofelia","op":"add"}]',
  'm:cats:s:litter/ofelia/settings': '{"rotation":["Леша","Карина"],"baseDate":"2026-06-16"}',
  'm:cats:s:cat/ofelia/profile':
    '{"name":"Офелия","breed":null,"birthDate":null,"sex":null,"sterilized":"unknown","bodyCondition":null,"avatar":null,"litterId":"ofelia"}',
}

describe('ofeliaToCatsMigration', () => {
  it('is a repeatable migration named ofelia-to-cats', () => {
    expect(ofeliaToCatsMigration.name).toBe('ofelia-to-cats')
    expect(ofeliaToCatsMigration.repeatable).toBe(true)
  })

  it('copies the ledger and comments with their TTLs and leaves the sources', async () => {
    const ops = makeOps()
    await ops.set('m:ofelia:s:duty/ledger', '[{"id":"1","ts":1}]')
    await ops.set('m:ofelia:s:duty/comments:2026-06-15', '[]', 5000)
    await ops.set('m:ofelia:s:duty/comments:2026-06-22', '[{"id":"c","ts":2}]')

    const spy = vi.spyOn(ops, 'set')
    expect(await ofeliaToCatsMigration.run(ops)).toBeUndefined()

    expect(spy).toHaveBeenCalledWith(
      'm:cats:s:litter/ofelia/ledger',
      '[{"id":"1","ts":1}]',
      undefined,
    )
    expect(spy).toHaveBeenCalledWith('m:cats:s:litter/ofelia/comments:2026-06-15', '[]', 5000)
    expect(await ops.get('m:cats:s:litter/ofelia/comments:2026-06-22')).toBe('[{"id":"c","ts":2}]')
    expect(await ops.get('m:ofelia:s:duty/ledger')).toBe('[{"id":"1","ts":1}]')
    expect(await ops.get('m:ofelia:s:duty/comments:2026-06-15')).toBe('[]')
  })

  it('merges records written to the old keys after a rollback, once', async () => {
    const ops = makeOps()
    await ops.set('m:cats:s:litter/ofelia/ledger', JSON.stringify([rec('a', 1)]))
    await ops.set('m:ofelia:s:duty/ledger', JSON.stringify([rec('a', 1), rec('b', 2)]))

    await ofeliaToCatsMigration.run(ops)
    expect(JSON.parse((await ops.get('m:cats:s:litter/ofelia/ledger')) as string)).toEqual([
      rec('a', 1),
      rec('b', 2),
    ])

    const spy = vi.spyOn(ops, 'set')
    expect(await ofeliaToCatsMigration.run(ops)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('stores merged records in ts order, whichever side they came from', async () => {
    const ops = makeOps()
    await ops.set('m:cats:s:litter/ofelia/ledger', JSON.stringify([rec('newer', 3)]))
    await ops.set('m:ofelia:s:duty/ledger', JSON.stringify([rec('older', 2)]))

    await ofeliaToCatsMigration.run(ops)
    expect(JSON.parse((await ops.get('m:cats:s:litter/ofelia/ledger')) as string)).toEqual([
      rec('older', 2),
      rec('newer', 3),
    ])
  })

  describe('system closes the old release wrote after a rollback', () => {
    const user = { accountId: 'acc-1', name: 'Леша' }
    const system = { system: true }
    const entry = (
      id: string,
      ts: number,
      date: string,
      type: string,
      createdBy: object,
      extra: object = {},
    ) => ({ id, ts, date, type, actor: 'Леша', createdBy, by: 'Леша', ...extra })
    const LEDGER = 'm:cats:s:litter/ofelia/ledger'
    const OLD_LEDGER = 'm:ofelia:s:duty/ledger'
    const readLedger = async (ops: ReturnType<typeof makeOps>) =>
      LedgerEntriesSchema.parse(JSON.parse((await ops.get(LEDGER)) as string))
    const idsIn = async (ops: ReturnType<typeof makeOps>) =>
      (await readLedger(ops)).map((e) => e.id)

    it('keep a decision users made in the cats release for the same day', async () => {
      const ops = makeOps()
      const debt = entry('debt', 10, '2026-07-01', 'went_into_debt', user, {
        actor: 'Карина',
        onBehalfOf: 'Леша',
      })
      await ops.set(LEDGER, JSON.stringify([debt]))
      await ops.set(
        OLD_LEDGER,
        JSON.stringify([entry('auto', 20, '2026-07-01', 'cleaned', system)]),
      )

      expect(await ofeliaToCatsMigration.run(ops)).toBeUndefined()

      expect(await idsIn(ops)).toEqual(['debt'])
      expect(resolveDays(await readLedger(ops)).get('2026-07-01')?.type).toBe('went_into_debt')
    })

    it('copy a system close for a day the cats release left open', async () => {
      const ops = makeOps()
      await ops.set(LEDGER, JSON.stringify([entry('mine', 10, '2026-07-01', 'cleaned', user)]))
      await ops.set(
        OLD_LEDGER,
        JSON.stringify([entry('auto', 20, '2026-07-02', 'cleaned', system)]),
      )

      await ofeliaToCatsMigration.run(ops)
      expect(await idsIn(ops)).toEqual(['mine', 'auto'])
      expect(resolveDays(await readLedger(ops)).get('2026-07-02')?.status).toBe('closed')

      const spy = vi.spyOn(ops, 'set')
      expect(await ofeliaToCatsMigration.run(ops)).toBeUndefined()
      expect(spy).not.toHaveBeenCalled()
    })

    it('do not settle a debt again from a view that missed the cats-release decisions', async () => {
      const ops = makeOps()
      // Settled in the cats release, on another day: the old release never saw it.
      const settled = entry('settled', 10, '2026-07-01', 'cleaned', user, {
        actor: 'Карина',
        onBehalfOf: 'Леша',
      })
      await ops.set(LEDGER, JSON.stringify([settled]))
      const stale = entry('auto', 20, '2026-07-02', 'cleaned', system, {
        actor: 'Карина',
        onBehalfOf: 'Леша',
      })
      await ops.set(OLD_LEDGER, JSON.stringify([stale]))

      await ofeliaToCatsMigration.run(ops)
      expect(await idsIn(ops)).toEqual(['settled'])

      const spy = vi.spyOn(ops, 'set')
      expect(await ofeliaToCatsMigration.run(ops)).toBeUndefined()
      expect(spy).not.toHaveBeenCalled()
    })

    it('still copy a system close when the only outcome for its day is one the old release saw', async () => {
      const ops = makeOps()
      const shared = entry('shared', 10, '2026-07-01', 'cleaned', user)
      const reset = entry('reset', 15, '2026-07-01', 'reset', user)
      await ops.set(LEDGER, JSON.stringify([shared]))
      await ops.set(
        OLD_LEDGER,
        JSON.stringify([shared, reset, entry('auto', 20, '2026-07-01', 'cleaned', system)]),
      )

      await ofeliaToCatsMigration.run(ops)
      expect(await idsIn(ops)).toEqual(['shared', 'reset', 'auto'])
    })
  })

  it('copies the cron cursor and never overwrites an existing target', async () => {
    const ops = makeOps()
    await ops.set('cron:module:ofelia:autoApproveDay', '"2026-06-15"')
    await ofeliaToCatsMigration.run(ops)
    expect(await ops.get('cron:module:cats:autoApproveDay')).toBe('"2026-06-15"')

    await ops.set('cron:module:ofelia:autoApproveDay', '"2026-07-01"')
    await ofeliaToCatsMigration.run(ops)
    expect(await ops.get('cron:module:cats:autoApproveDay')).toBe('"2026-06-15"')
  })

  it('seeds all four keys when absent, without a TTL', async () => {
    const ops = makeOps()
    const spy = vi.spyOn(ops, 'set')
    await ofeliaToCatsMigration.run(ops)
    for (const [key, value] of Object.entries(seeds)) {
      expect(await ops.get(key)).toBe(value)
      expect(spy).toHaveBeenCalledWith(key, value)
    }
  })

  it('does not overwrite an existing seed key', async () => {
    const ops = makeOps()
    const edited = JSON.stringify({
      ...JSON.parse(seeds['m:cats:s:cat/ofelia/profile']),
      name: 'Офелия Константиновна',
    })
    await ops.set('m:cats:s:cat/ofelia/profile', edited)
    await ofeliaToCatsMigration.run(ops)
    expect(await ops.get('m:cats:s:cat/ofelia/profile')).toBe(edited)
    expect(await ops.get('m:cats:s:registry/cats')).toBe(seeds['m:cats:s:registry/cats'])
  })

  it('writes seeds that parse with the module schemas', () => {
    const parse = (schema: z.ZodType, key: keyof typeof seeds) =>
      schema.safeParse(JSON.parse(seeds[key])).success
    expect(parse(CatRegistryEventsSchema, 'm:cats:s:registry/cats')).toBe(true)
    expect(parse(LitterRegistryEventsSchema, 'm:cats:s:registry/litters')).toBe(true)
    expect(parse(LitterSettingsSchema, 'm:cats:s:litter/ofelia/settings')).toBe(true)
    expect(parse(CatProfileSchema, 'm:cats:s:cat/ofelia/profile')).toBe(true)
    // the parse check can fail
    expect(LitterSettingsSchema.safeParse({ rotation: [], baseDate: 'x' }).success).toBe(false)
    // the registry schemas drop bad elements rather than failing, so check the element survives
    expect(CatRegistryEventsSchema.parse(JSON.parse(seeds['m:cats:s:registry/cats']))).toHaveLength(
      1,
    )
    expect(CatRegistryEventsSchema.parse([{ nope: 1 }])).toHaveLength(0)
  })

  it('is readable through module storage for module cats', async () => {
    const ops = makeOps()
    await ofeliaToCatsMigration.run(ops)
    const { shared } = makeModuleServerStorage({
      ops,
      moduleId: 'cats',
      scopes: ['shared'],
      viewer: null,
      now: () => 1,
    })
    const read = await shared?.get('registry/cats', CatRegistryEventsSchema)
    expect(read).toEqual([{ id: 'seed:ofelia', ts: 0, catId: 'ofelia', op: 'add' }])
  })

  it('leaves cat-care data alone', async () => {
    const ops = makeOps()
    await ops.set('w:i:x:ledger', '[{"id":"z"}]')
    await ofeliaToCatsMigration.run(ops)
    expect(await ops.get('w:i:x:ledger')).toBe('[{"id":"z"}]')
    const catKeys = (await ops.scanKeys('m:cats:s:cat/')).sort()
    expect(catKeys).toEqual(['m:cats:s:cat/ofelia/profile'])
  })
})
