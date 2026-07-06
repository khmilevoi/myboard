import { describe, expect, it } from 'vitest'

import { lookupInvite } from '../src/auth/invites'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { parseArgs, runCreateInvite } from './create-invite'

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

describe('parseArgs', () => {
  it('defaults ttl to 7d and maxUses to 1', () => {
    const result = parseArgs([])

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.ttlMs).toBe(604_800_000)
    expect(result.maxUses).toBe(1)
    expect(result.label).toBeUndefined()
  })

  it('parses --label, --ttl, and --max-uses overrides', () => {
    const result = parseArgs(['--label', 'front door', '--ttl', '3d', '--max-uses', '5'])

    expect(result).not.toBeInstanceOf(Error)
    if (result instanceof Error) throw result
    expect(result.label).toBe('front door')
    expect(result.ttlMs).toBe(259_200_000)
    expect(result.maxUses).toBe(5)
  })

  it('returns an Error on a malformed --ttl', () => {
    const result = parseArgs(['--ttl', 'not-a-duration'])

    expect(result).toBeInstanceOf(Error)
  })

  it('returns an Error on a non-numeric --max-uses', () => {
    const result = parseArgs(['--max-uses', 'abc'])

    expect(result).toBeInstanceOf(Error)
  })
})

describe('runCreateInvite', () => {
  it('returns an activate URL and creates a live invite', async () => {
    const ops = makeOps()
    const now = () => 1_000
    const args = parseArgs([])
    if (args instanceof Error) throw args

    const url = await runCreateInvite(ops, now, 'https://board.iiskelo.com', args)

    expect(url).toMatch(/^https?:\/\/.+\/activate\?token=.+$/)

    const token = new URL(url).searchParams.get('token')
    expect(token).toBeTruthy()

    const record = await lookupInvite(ops, now, token as string)
    expect(record).not.toBeInstanceOf(Error)
  })
})
