import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import ofeliaServer from '@widgets/ofelia-poop-duty/server'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeCronScheduler } from './cron-scheduler'
import { createWidgetServerRegistry } from './registry'

const LEDGER_KEY = 'w:t:ofelia-poop-duty:ledger'
const NOON_0616 = Date.parse('2026-06-16T12:00:00+02:00')
const AFTER_MIDNIGHT_0617 = Date.parse('2026-06-17T00:06:00+02:00')

function makeSetup() {
  const ops = createMemoryOps(createMemoryPubSub())
  const registry = createWidgetServerRegistry([
    toRuntimeWidgetServerDefinition({ typeId: 'ofelia-poop-duty', definition: ofeliaServer }),
  ])
  if (registry instanceof Error) throw registry

  let nowMs = NOON_0616
  const scheduler = makeCronScheduler({
    registry,
    ops,
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

async function readLedger(ops: ReturnType<typeof createMemoryOps>) {
  const raw = await ops.get(LEDGER_KEY)
  return raw === null ? [] : (JSON.parse(raw) as { date: string; createdBy: unknown }[])
}

describe('ofelia auto-approve cron end to end', () => {
  it('writes nothing on the seeding tick', async () => {
    const { ops, scheduler } = makeSetup()
    await scheduler.tick()

    expect(await readLedger(ops)).toEqual([])
  })

  it('closes the unresolved window once the occurrence comes due', async () => {
    const { ops, scheduler, setNow } = makeSetup()
    await scheduler.tick()

    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()

    const ledger = await readLedger(ops)
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
    await scheduler.tick()
    setNow(AFTER_MIDNIGHT_0617)
    await scheduler.tick()
    const after = await readLedger(ops)

    await scheduler.tick()

    expect(await readLedger(ops)).toHaveLength(after.length)
  })
})
