import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { cronStateKey, readCronState, writeCronState } from './cron-state'

const makeOps = () => createMemoryOps(createMemoryPubSub())

describe('cron state', () => {
  it('derives a key outside the widget storage namespace', () => {
    expect(cronStateKey('ofelia-poop-duty', 'autoApproveDay')).toBe(
      'cron:ofelia-poop-duty:autoApproveDay',
    )
  })

  it('returns null when no state was ever written', async () => {
    expect(await readCronState(makeOps(), 'w', 'j')).toBeNull()
  })

  it('round-trips a written state', async () => {
    const ops = makeOps()
    await writeCronState(ops, 'w', 'j', { cursorMs: 1234, failures: 2 })

    expect(await readCronState(ops, 'w', 'j')).toEqual({ cursorMs: 1234, failures: 2 })
  })

  it('returns an error for a corrupt stored value', async () => {
    const ops = makeOps()
    await ops.set(cronStateKey('w', 'j'), '{"cursorMs":"nope"}')

    expect(await readCronState(ops, 'w', 'j')).toBeInstanceOf(Error)
  })
})
