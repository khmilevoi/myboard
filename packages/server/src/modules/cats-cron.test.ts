import catsServer from '@modules/cats/server'
import { toRuntimeModuleServerDefinition } from '@shared/modules/contracts'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import type { ValkeyOps } from '../storage/valkey'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeCronScheduler } from '../widgets/cron-scheduler'
import { createWidgetServerRegistry } from '../widgets/registry'
import { makeModuleServerRegistry } from './registry'

const LEDGER_KEY = 'm:cats:s:litter/ofelia/ledger'
const CURSOR_KEY = 'cron:module:cats:autoApproveDay'
const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const AFTER_MIDNIGHT_0617 = Date.parse('2026-06-17T00:06:00+02:00')

function makeSetup(wrapOps: (ops: ReturnType<typeof createMemoryOps>) => ValkeyOps = (ops) => ops) {
  const ops = createMemoryOps(createMemoryPubSub())
  const registry = makeModuleServerRegistry([
    toRuntimeModuleServerDefinition({ moduleId: 'cats', definition: catsServer }),
  ])
  if (registry instanceof Error) throw registry

  let nowMs = NOON_0616
  const emptyWidgets = createWidgetServerRegistry([])
  if (emptyWidgets instanceof Error) throw emptyWidgets
  const scheduler = makeCronScheduler({
    registry: emptyWidgets,
    moduleRegistry: registry,
    ops: wrapOps(ops),
    browserClient: makeFakeBrowserAutomationClient().client,
    now: () => nowMs,
  })
  return {
    ops,
    scheduler,
    setNow: (ms: number) => {
      nowMs = ms
    },
  }
}

/**
 * Fails only the Nth `set()` call that targets `key`, succeeding on every
 * other call and every other key -- a stand-in for a Valkey write that drops
 * mid-batch, without touching the production storage/scheduler code.
 */
function makeOpsThatFailsNthSet(ops: ValkeyOps, key: string, failOnCall: number): ValkeyOps {
  let calls = 0
  return {
    get: ops.get,
    del: ops.del,
    getdel: ops.getdel,
    pttl: ops.pttl,
    scanKeys: ops.scanKeys,
    publish: ops.publish,
    async set(setKey, value, ttlMs) {
      if (setKey === key) {
        calls += 1
        if (calls === failOnCall) throw new Error('simulated write failure')
      }
      return ops.set(setKey, value, ttlMs)
    },
  }
}

async function readLedger(ops: ReturnType<typeof createMemoryOps>, key = LEDGER_KEY) {
  const raw = await ops.get(key)
  return raw === null ? [] : (JSON.parse(raw) as { date: string; createdBy: unknown }[])
}

// A seed record dated well before the auto-approve window, only to mark the
// widget as already used (a genuinely never-placed widget leaves the ledger
// key absent and the cron must no-op there — see server.test.ts's F11
// coverage). These end-to-end tests exercise a widget that has been placed
// and used at least once, then left untouched for the auto-approve window.
const SEED_ENTRY = {
  date: '2026-01-01',
  type: 'cleaned',
  actor: 'Леша',
  createdBy: null,
}

type MemoryOps = ReturnType<typeof createMemoryOps>

const BUSYA_LEDGER_KEY = 'm:cats:s:litter/busya/ledger'
const BUSYA_SETTINGS_KEY = 'm:cats:s:litter/busya/settings'

async function seedRegistry(ops: MemoryOps, catIds: string[], archived: string[] = []) {
  const events = [
    ...catIds.map((catId, index) => ({ id: `add-${catId}`, ts: index + 1, catId, op: 'add' })),
    ...archived.map((catId, index) => ({
      id: `archive-${catId}`,
      ts: 100 + index,
      catId,
      op: 'archive',
    })),
  ]
  await ops.set('m:cats:s:registry/cats', JSON.stringify(events))
  await ops.set(
    'm:cats:s:registry/litters',
    JSON.stringify(
      catIds.map((litterId, index) => ({
        id: `l-${litterId}`,
        ts: index + 1,
        litterId,
        op: 'add',
      })),
    ),
  )
  for (const catId of catIds) {
    await ops.set(
      `m:cats:s:cat/${catId}/profile`,
      JSON.stringify({
        name: catId,
        breed: null,
        birthDate: null,
        sex: null,
        sterilized: 'unknown',
        bodyCondition: null,
        avatar: null,
        litterId: catId,
      }),
    )
  }
}

async function seedLedger(ops: MemoryOps, key = LEDGER_KEY) {
  await ops.set(key, JSON.stringify([{ id: 'seed', ts: 0, ...SEED_ENTRY }]))
  if (key === LEDGER_KEY) await seedRegistry(ops, ['ofelia'])
}

describe('cats auto-approve cron end to end', () => {
  it('writes nothing on the seeding tick', async () => {
    const { ops, scheduler } = makeSetup()
    await seedLedger(ops)
    await scheduler.tick()

    // The seeding tick records the module cursor under the module-namespaced key.
    expect(await ops.get(CURSOR_KEY)).not.toBeNull()
    expect(await ops.get('cron:ofelia-poop-duty:autoApproveDay')).toBeNull()

    // Drop the seed record: it predates the auto-approve window and is only
    // there to mark the widget as already used.
    const ledger = (await readLedger(ops)).filter((record) => record.date !== SEED_ENTRY.date)
    expect(ledger).toEqual([])
  })

  it('closes the unresolved window once the occurrence comes due', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await seedLedger(ops)
    await scheduler.tick()

    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()

    // Drop the seed record: it predates the auto-approve window and is only
    // there to mark the widget as already used.
    const ledger = (await readLedger(ops)).filter((record) => record.date !== SEED_ENTRY.date)
    expect(ledger.map((record) => record.date)).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ])
    expect(ledger.every((record) => (record.createdBy as { system?: true })?.system)).toBe(true)
  })

  it('adds nothing on a second tick for the same occurrence', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await seedLedger(ops)
    await scheduler.tick()
    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()
    // Drop the seed record: it predates the auto-approve window and is only
    // there to mark the widget as already used, so it can't stand in for the
    // window actually having closed.
    const closedDates = (await readLedger(ops))
      .filter((record) => record.date !== SEED_ENTRY.date)
      .map((record) => record.date)
    // The window must actually have closed for this to be a meaningful
    // idempotency check rather than a vacuous 0-equals-0 comparison.
    expect(closedDates).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ])

    await scheduler.tick()

    const afterSecondTick = (await readLedger(ops))
      .filter((record) => record.date !== SEED_ENTRY.date)
      .map((record) => record.date)
    expect(afterSecondTick).toEqual(closedDates)
  })

  it('retries a partially failed run without duplicating the days it already closed', async () => {
    // The window closes 7 days (2026-06-10..16); fail the 4th append
    // (2026-06-13) so the job returns an error after writing only the first
    // three -- the real shape of a Valkey write dropping mid-batch.
    const { ops, scheduler, setNow } = makeSetup((memoryOps) =>
      makeOpsThatFailsNthSet(memoryOps, LEDGER_KEY, 4),
    )
    await seedLedger(ops)
    await scheduler.tick()

    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()

    // Drop the seed record: it predates the auto-approve window and is only
    // there to mark the widget as already used.
    expect(
      (await readLedger(ops))
        .filter((record) => record.date !== SEED_ENTRY.date)
        .map((record) => record.date),
    ).toEqual(['2026-06-10', '2026-06-11', '2026-06-12'])

    // Retried on the next tick, at the same occurrence: the cursor did not
    // advance past the failed run, so this must finish the remaining days
    // without re-writing the three that already landed.
    await scheduler.tick()

    const ledger = (await readLedger(ops)).filter((record) => record.date !== SEED_ENTRY.date)
    expect(ledger.map((record) => record.date)).toEqual([
      '2026-06-10',
      '2026-06-11',
      '2026-06-12',
      '2026-06-13',
      '2026-06-14',
      '2026-06-15',
      '2026-06-16',
    ])
    expect(new Set(ledger.map((record) => record.date)).size).toBe(7)
  })

  describe('with several litters', () => {
    const seedTwoLitters = async (ops: MemoryOps, archived: string[] = []) => {
      await seedRegistry(ops, ['ofelia', 'busya'], archived)
      await seedLedger(ops, LEDGER_KEY)
      await seedLedger(ops, BUSYA_LEDGER_KEY)
      await seedRegistry(ops, ['ofelia', 'busya'], archived)
    }
    const nonSeed = async (ops: MemoryOps, key: string) =>
      (await readLedger(ops, key)).filter((record) => record.date !== SEED_ENTRY.date)

    it('closes every active cat litter', async () => {
      const { ops, scheduler, setNow } = makeSetup()
      await seedTwoLitters(ops)
      await scheduler.tick()
      setNow(AFTER_MIDNIGHT_0617)
      await scheduler.tick()

      for (const key of [LEDGER_KEY, BUSYA_LEDGER_KEY]) {
        const closed = await nonSeed(ops, key)
        expect(closed.map((record) => record.date)).toContain('2026-06-16')
        expect(closed.every((record) => (record.createdBy as { system?: true })?.system)).toBe(true)
      }
    })

    it("skips an archived cat's litter", async () => {
      const { ops, scheduler, setNow } = makeSetup()
      await seedTwoLitters(ops, ['busya'])
      await scheduler.tick()
      setNow(AFTER_MIDNIGHT_0617)
      await scheduler.tick()

      expect((await nonSeed(ops, LEDGER_KEY)).length).toBeGreaterThan(0)
      expect(await readLedger(ops, BUSYA_LEDGER_KEY)).toHaveLength(1)
    })

    it('writes nothing, and still advances the cursor, with no registry', async () => {
      const { ops, scheduler, setNow } = makeSetup()
      await ops.set(LEDGER_KEY, JSON.stringify([{ id: 'seed', ts: 0, ...SEED_ENTRY }]))
      await scheduler.tick()
      const seededCursor = await ops.get(CURSOR_KEY)
      setNow(AFTER_MIDNIGHT_0617)
      await scheduler.tick()

      expect(await readLedger(ops)).toHaveLength(1)
      const cursor = await ops.get(CURSOR_KEY)
      expect(cursor).not.toBeNull()
      expect(cursor).not.toBe(seededCursor)
    })

    it('does not let one failing litter stop the others, and retries it later', async () => {
      const { ops, scheduler, setNow } = makeSetup((memoryOps) =>
        makeOpsThatFailsNthSet(memoryOps, LEDGER_KEY, 1),
      )
      await seedTwoLitters(ops)
      await scheduler.tick()
      const seededCursor = await ops.get(CURSOR_KEY)
      setNow(AFTER_MIDNIGHT_0617)
      await scheduler.tick()

      expect(await nonSeed(ops, LEDGER_KEY)).toEqual([])
      const busyaDates = (await nonSeed(ops, BUSYA_LEDGER_KEY)).map((record) => record.date)
      expect(busyaDates).toContain('2026-06-16')
      const cursorMs = async () => JSON.parse((await ops.get(CURSOR_KEY)) as string).cursorMs
      expect(await cursorMs()).toBe(JSON.parse(seededCursor as string).cursorMs)

      await scheduler.tick()

      expect((await nonSeed(ops, LEDGER_KEY)).map((record) => record.date)).toContain('2026-06-16')
      const retried = (await nonSeed(ops, BUSYA_LEDGER_KEY)).map((record) => record.date)
      expect(retried).toEqual(busyaDates)
      expect(new Set(retried).size).toBe(retried.length)
    })

    it("closes each litter by its own settings' rotation", async () => {
      const { ops, scheduler, setNow } = makeSetup()
      await seedTwoLitters(ops)
      await ops.set(
        BUSYA_SETTINGS_KEY,
        JSON.stringify({ rotation: ['Карина', 'Леша'], baseDate: '2026-06-16' }),
      )
      await scheduler.tick()
      setNow(AFTER_MIDNIGHT_0617)
      await scheduler.tick()

      const day = (records: { date: string; actor?: unknown }[]) =>
        records.find((record) => record.date === '2026-06-16')
      expect(day(await nonSeed(ops, LEDGER_KEY))?.actor).toBe('Леша')
      expect(day(await nonSeed(ops, BUSYA_LEDGER_KEY))?.actor).toBe('Карина')
    })
  })
})
