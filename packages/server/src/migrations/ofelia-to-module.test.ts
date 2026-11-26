import { describe, expect, it, vi } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { productionMigrations } from './index'
import { ofeliaToModuleMigration } from './ofelia-to-module'
import { migrationKey, runMigrations } from './runner'

const makeOps = () => createMemoryOps(createMemoryPubSub())
const rec = (id: string, ts: number) => ({ id, ts, text: id })

describe('ofeliaToModuleMigration', () => {
  it('is named ofelia-to-module', () => {
    expect(ofeliaToModuleMigration.name).toBe('ofelia-to-module')
  })

  it('copies ledger and comments under duty/ and leaves the old keys', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:ledger', '[{"id":"1"}]')
    await ops.set('w:t:ofelia-poop-duty:comments:2026-06-15', '[]')

    expect(await ofeliaToModuleMigration.run(ops)).toBeUndefined()

    expect(await ops.get('m:ofelia:s:duty/ledger')).toBe('[{"id":"1"}]')
    expect(await ops.get('m:ofelia:s:duty/comments:2026-06-15')).toBe('[]')
    expect(await ops.get('w:t:ofelia-poop-duty:ledger')).toBe('[{"id":"1"}]')
  })

  it('copies the cron cursor', async () => {
    const ops = makeOps()
    await ops.set('cron:ofelia-poop-duty:autoApproveDay', '"2026-06-15"')

    expect(await ofeliaToModuleMigration.run(ops)).toBeUndefined()

    expect(await ops.get('cron:module:ofelia:autoApproveDay')).toBe('"2026-06-15"')
  })

  it('never overwrites an existing target', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:ledger', '"old"')
    await ops.set('m:ofelia:s:duty/ledger', '"new"')
    await ops.set('cron:ofelia-poop-duty:autoApproveDay', '"old"')
    await ops.set('cron:module:ofelia:autoApproveDay', '"new"')

    await ofeliaToModuleMigration.run(ops)

    expect(await ops.get('m:ofelia:s:duty/ledger')).toBe('"new"')
    expect(await ops.get('cron:module:ofelia:autoApproveDay')).toBe('"new"')
  })

  it('keeps a TTL and copies a TTL-less key without one (never -1)', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:ledger', '[]')
    await ops.set('w:t:ofelia-poop-duty:comments:x', '[]', 5000)
    await ops.set('cron:ofelia-poop-duty:autoApproveDay', '"d"', 9000)

    const spy = vi.spyOn(ops, 'set')
    await ofeliaToModuleMigration.run(ops)

    expect(spy).toHaveBeenCalledWith('m:ofelia:s:duty/ledger', '[]', undefined)
    expect(spy).toHaveBeenCalledWith('m:ofelia:s:duty/comments:x', '[]', 5000)
    expect(await ops.pttl('cron:module:ofelia:autoApproveDay')).toBe(9000)

    expect(await ops.pttl('w:t:ofelia-poop-duty:ledger')).toBe(-1)
    expect(await ops.pttl('m:ofelia:s:duty/ledger')).toBe(-1)
    expect(await ops.pttl('m:ofelia:s:duty/comments:x')).toBe(5000)
  })

  it('leaves old keys and the old cron cursor byte-identical, TTLs included (rollback safety)', async () => {
    const ops = makeOps()
    const raw = '{ "a" :  1,\n"b":[ 2 ] }'
    await ops.set('w:t:ofelia-poop-duty:ledger', raw)
    await ops.set('w:t:ofelia-poop-duty:comments:x', raw, 7000)
    await ops.set('cron:ofelia-poop-duty:autoApproveDay', raw, 9000)

    await ofeliaToModuleMigration.run(ops)

    expect(await ops.get('w:t:ofelia-poop-duty:ledger')).toBe(raw)
    expect(await ops.get('w:t:ofelia-poop-duty:comments:x')).toBe(raw)
    expect(await ops.get('cron:ofelia-poop-duty:autoApproveDay')).toBe(raw)
    expect(await ops.pttl('w:t:ofelia-poop-duty:ledger')).toBe(-1)
    expect(await ops.pttl('w:t:ofelia-poop-duty:comments:x')).toBe(7000)
    expect(await ops.pttl('cron:ofelia-poop-duty:autoApproveDay')).toBe(9000)
    expect(await ops.get('m:ofelia:s:duty/ledger')).toBe(raw)
  })

  it('is idempotent: a second run performs no set()', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:ledger', '[]')
    await ops.set('cron:ofelia-poop-duty:autoApproveDay', '"d"')
    await ofeliaToModuleMigration.run(ops)

    const spy = vi.spyOn(ops, 'set')
    expect(await ofeliaToModuleMigration.run(ops)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('copies only what is missing after a crashed partial run', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:ledger', '[1]')
    await ops.set('w:t:ofelia-poop-duty:comments:a', JSON.stringify([rec('a', 1)]))
    await ops.set('w:t:ofelia-poop-duty:comments:b', '["b"]')
    // crash left one target copied, and later edited by the module
    const edited = JSON.stringify([rec('a', 1), rec('a2', 2)])
    await ops.set('m:ofelia:s:duty/comments:a', edited)

    const spy = vi.spyOn(ops, 'set')
    expect(await ofeliaToModuleMigration.run(ops)).toBeUndefined()

    const written = spy.mock.calls.map((c) => c[0]).sort()
    expect(written).toEqual(['m:ofelia:s:duty/comments:b', 'm:ofelia:s:duty/ledger'])
    expect(await ops.get('m:ofelia:s:duty/comments:a')).toBe(edited)
    expect(await ops.get('m:ofelia:s:duty/comments:b')).toBe('["b"]')
  })

  it('is repeatable: the runner reruns it despite its marker', async () => {
    expect(ofeliaToModuleMigration.repeatable).toBe(true)
  })

  it('merges records written to the old keys during a rollback into the module keys', async () => {
    const ops = makeOps()
    const ledgerSource = 'w:t:ofelia-poop-duty:ledger'
    const ledgerTarget = 'm:ofelia:s:duty/ledger'
    const commentsSource = 'w:t:ofelia-poop-duty:comments:2026-06-15'
    const commentsTarget = 'm:ofelia:s:duty/comments:2026-06-15'
    await ops.set(ledgerSource, JSON.stringify([rec('a', 1)]))
    await ops.set(commentsSource, JSON.stringify([rec('c1', 1)]))

    // first module release boots and copies
    await runMigrations(ops, productionMigrations, () => 1)
    // the module release writes to its own keys only
    await ops.set(ledgerTarget, JSON.stringify([rec('a', 1), rec('b', 2)]))
    // rollback: the pre-module release appends to the old keys only
    const sourceAfterRollback = JSON.stringify([rec('a', 1), rec('r1', 3), rec('r2', 4)])
    await ops.set(ledgerSource, sourceAfterRollback)
    await ops.set(commentsSource, JSON.stringify([rec('c1', 1), rec('c2', 5)]))

    // roll forward: the marker exists, the migration runs anyway
    expect(await runMigrations(ops, productionMigrations, () => 2)).toBeUndefined()

    expect(JSON.parse((await ops.get(ledgerTarget)) as string)).toEqual([
      rec('a', 1),
      rec('b', 2),
      rec('r1', 3),
      rec('r2', 4),
    ])
    expect(JSON.parse((await ops.get(commentsTarget)) as string)).toEqual([
      rec('c1', 1),
      rec('c2', 5),
    ])
    expect(await ops.get(ledgerSource)).toBe(sourceAfterRollback)

    // and a further boot changes nothing
    const spy = vi.spyOn(ops, 'set')
    expect(await ofeliaToModuleMigration.run(ops)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('orders merged records by ts, the target first on a tie', async () => {
    const ops = makeOps()
    await ops.set('m:ofelia:s:duty/ledger', JSON.stringify([rec('t1', 1), rec('t5', 5)]))
    await ops.set(
      'w:t:ofelia-poop-duty:ledger',
      JSON.stringify([rec('s3', 3), rec('s5', 5), rec('t1', 1)]),
    )

    await ofeliaToModuleMigration.run(ops)

    const merged = JSON.parse((await ops.get('m:ofelia:s:duty/ledger')) as string) as {
      id: string
    }[]
    expect(merged.map((r) => r.id)).toEqual(['t1', 's3', 't5', 's5'])
  })

  it('keeps the target TTL when it merges into an existing target', async () => {
    const ops = makeOps()
    await ops.set('m:ofelia:s:duty/comments:x', JSON.stringify([rec('a', 1)]), 4000)
    await ops.set('w:t:ofelia-poop-duty:comments:x', JSON.stringify([rec('b', 2)]), 9000)

    await ofeliaToModuleMigration.run(ops)

    expect(await ops.pttl('m:ofelia:s:duty/comments:x')).toBe(4000)
    expect(JSON.parse((await ops.get('m:ofelia:s:duty/comments:x')) as string)).toEqual([
      rec('a', 1),
      rec('b', 2),
    ])
  })

  it('skips a source key that expired between its read and its PTTL (-2)', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:comments:gone', JSON.stringify([rec('a', 1)]), 10)
    await ops.set('cron:ofelia-poop-duty:autoApproveDay', '"d"', 10)
    vi.spyOn(ops, 'pttl').mockResolvedValue(-2)

    const spy = vi.spyOn(ops, 'set')
    expect(await ofeliaToModuleMigration.run(ops)).toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
  })

  it('is recorded by the runner via productionMigrations', async () => {
    const ops = makeOps()
    await ops.set('w:t:ofelia-poop-duty:ledger', '[]')

    expect(await runMigrations(ops, productionMigrations, () => 42)).toBeUndefined()

    expect(await ops.get(migrationKey('ofelia-to-module'))).toBe(
      JSON.stringify({ completedAt: 42 }),
    )
    expect(await ops.get('m:ofelia:s:duty/ledger')).toBe('[]')
  })

  it('registers ofelia-to-module before ofelia-to-cats', () => {
    expect(productionMigrations.map((m) => m.name)).toEqual(['ofelia-to-module', 'ofelia-to-cats'])
  })
})
