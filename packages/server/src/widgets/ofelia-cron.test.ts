import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import ofeliaServer from '@widgets/ofelia-poop-duty/server'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import type { ValkeyOps } from '../storage/valkey'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeCronScheduler } from './cron-scheduler'
import { createWidgetServerRegistry } from './registry'

const LEDGER_KEY = 'w:t:ofelia-poop-duty:ledger'
const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const AFTER_MIDNIGHT_0617 = Date.parse('2026-06-17T00:06:00+02:00')

function makeSetup(wrapOps: (ops: ReturnType<typeof createMemoryOps>) => ValkeyOps = (ops) => ops) {
  const ops = createMemoryOps(createMemoryPubSub())
  const registry = createWidgetServerRegistry([
    toRuntimeWidgetServerDefinition({ typeId: 'ofelia-poop-duty', definition: ofeliaServer }),
  ])
  if (registry instanceof Error) throw registry

  let nowMs = NOON_0616
  const scheduler = makeCronScheduler({
    registry,
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

async function readLedger(ops: ReturnType<typeof createMemoryOps>) {
  const raw = await ops.get(LEDGER_KEY)
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

async function seedLedger(ops: ReturnType<typeof createMemoryOps>) {
  await ops.set(LEDGER_KEY, JSON.stringify([{ id: 'seed', ts: 0, ...SEED_ENTRY }]))
}

describe('ofelia auto-approve cron end to end', () => {
  it('writes nothing on the seeding tick', async () => {
    const { ops, scheduler } = makeSetup()
    await seedLedger(ops)
    await scheduler.tick()

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
})
