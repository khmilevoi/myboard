import { describe, expect, it } from 'vitest'

import { sha256hex } from '../auth/tokens'
import { makeClock } from '../test/auth-fixtures'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { GatewayCodeInvalidError, GatewayUnauthorizedError } from './errors'
import { bindingsKey, gatewayTokenKey } from './keys'
import {
  authenticateGateway,
  GATEWAY_CODE_TTL_MS,
  mintGatewayCode,
  registerGateway,
  revokeGateway,
} from './registration'
import { getGateway, getHardware, putHardware } from './store'

const makeOps = () => createMemoryOps(createMemoryPubSub())

async function setup() {
  const ops = makeOps()
  const clock = makeClock(1_000)
  const minted = await mintGatewayCode(ops, clock.now, { accountId: 'acc1' })
  if (minted instanceof Error) throw minted
  return { ops, clock, minted }
}

const body = (code: string) => ({ code, label: 'Desk gateway' })

describe('mintGatewayCode', () => {
  it('returns a display code and the expiry', async () => {
    const { minted } = await setup()
    expect(minted.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
    expect(minted.expiresAt).toBe(1_000 + GATEWAY_CODE_TTL_MS)
    expect(GATEWAY_CODE_TTL_MS).toBe(300_000)
  })

  it('replaces the previous live code', async () => {
    const { ops, clock, minted } = await setup()
    const second = await mintGatewayCode(ops, clock.now, { accountId: 'acc1' })
    if (second instanceof Error) throw second
    expect(await registerGateway(ops, clock.now, body(minted.code))).toBeInstanceOf(
      GatewayCodeInvalidError,
    )
    expect(await registerGateway(ops, clock.now, body(second.code))).not.toBeInstanceOf(Error)
  })
})

describe('registerGateway', () => {
  it('accepts any case and no dash, and is single use', async () => {
    const { ops, clock, minted } = await setup()
    const result = await registerGateway(
      ops,
      clock.now,
      body(minted.code.replace('-', '').toLowerCase()),
    )
    if (result instanceof Error) throw result
    expect(result.gatewayId).toBeTruthy()
    expect(result.token).toBeTruthy()
    expect(await registerGateway(ops, clock.now, body(minted.code))).toBeInstanceOf(
      GatewayCodeInvalidError,
    )
  })

  it('creates the gateway record', async () => {
    const { ops, clock, minted } = await setup()
    const result = await registerGateway(ops, clock.now, body(minted.code))
    if (result instanceof Error) throw result
    const record = await getGateway(ops, result.gatewayId)
    expect(record).toMatchObject({
      label: 'Desk gateway',
      createdAt: 1_000,
      lastSeenAt: 1_000,
      createdBy: 'acc1',
      connectedAt: null,
      adapter: null,
      bonded: [],
    })
  })

  it('expires at the TTL', async () => {
    const { ops, clock, minted } = await setup()
    clock.set(1_000 + GATEWAY_CODE_TTL_MS)
    expect(await registerGateway(ops, clock.now, body(minted.code))).toBeInstanceOf(
      GatewayCodeInvalidError,
    )
  })

  it('locks after 10 wrong attempts but not after 9', async () => {
    const wrong = async (ops: ReturnType<typeof makeOps>, now: () => number, n: number) => {
      for (let i = 0; i < n; i++) {
        const r = await registerGateway(ops, now, body('0000-0000'))
        expect(r).toBeInstanceOf(GatewayCodeInvalidError)
      }
    }
    const a = await setup()
    await wrong(a.ops, a.clock.now, 10)
    expect(await registerGateway(a.ops, a.clock.now, body(a.minted.code))).toBeInstanceOf(
      GatewayCodeInvalidError,
    )
    const b = await setup()
    await wrong(b.ops, b.clock.now, 9)
    expect(await registerGateway(b.ops, b.clock.now, body(b.minted.code))).not.toBeInstanceOf(Error)
  })

  it('counts unnormalizable input as a failed attempt', async () => {
    const { ops, clock, minted } = await setup()
    for (let i = 0; i < 10; i++) await registerGateway(ops, clock.now, body('nope'))
    expect(await registerGateway(ops, clock.now, body(minted.code))).toBeInstanceOf(
      GatewayCodeInvalidError,
    )
  })

  it('stores only the token hash', async () => {
    const { ops, clock, minted } = await setup()
    const result = await registerGateway(ops, clock.now, body(minted.code))
    if (result instanceof Error) throw result
    const keys = await ops.scanKeys('')
    expect(keys.some((k) => k.includes(result.token))).toBe(false)
    expect(keys).toContain(gatewayTokenKey(sha256hex(result.token)))
    for (const key of keys) {
      expect(((await ops.get(key)) ?? '').includes(result.token)).toBe(false)
    }
  })
})

describe('authenticateGateway', () => {
  it('returns the record and advances lastSeenAt', async () => {
    const { ops, clock, minted } = await setup()
    const reg = await registerGateway(ops, clock.now, body(minted.code))
    if (reg instanceof Error) throw reg
    clock.set(9_000)
    const record = await authenticateGateway(ops, clock.now, `Bearer ${reg.token}`)
    if (record instanceof Error) throw record
    expect(record.id).toBe(reg.gatewayId)
    expect(record.lastSeenAt).toBe(9_000)
    expect(await getGateway(ops, reg.gatewayId)).toMatchObject({ lastSeenAt: 9_000 })
  })

  it('rejects missing, wrong-scheme and unknown tokens', async () => {
    const { ops, clock } = await setup()
    for (const header of [undefined, 'Basic x', 'Bearer nope']) {
      expect(await authenticateGateway(ops, clock.now, header)).toBeInstanceOf(
        GatewayUnauthorizedError,
      )
    }
  })
})

describe('revokeGateway', () => {
  it('invalidates the token and detaches hardware, keeping bindings', async () => {
    const { ops, clock, minted } = await setup()
    const reg = await registerGateway(ops, clock.now, body(minted.code))
    if (reg instanceof Error) throw reg
    await putHardware(ops, {
      id: 'h1',
      gatewayId: reg.gatewayId,
      address: 'AA:BB:CC:DD:EE:FF',
      model: 'beurer-bf950',
      createdAt: 1,
      battery: null,
      lastReadingAt: null,
      scaleUsers: [],
    })
    await ops.set(bindingsKey('h1'), '[]')
    expect(await revokeGateway(ops, reg.gatewayId)).toBeUndefined()
    expect(await authenticateGateway(ops, clock.now, `Bearer ${reg.token}`)).toBeInstanceOf(
      GatewayUnauthorizedError,
    )
    expect(await getGateway(ops, reg.gatewayId)).toBeNull()
    expect(await getHardware(ops, 'h1')).toMatchObject({ gatewayId: null })
    expect(await ops.get(bindingsKey('h1'))).toBe('[]')
  })
})
