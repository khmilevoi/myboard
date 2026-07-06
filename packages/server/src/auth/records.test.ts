import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import {
  accountDevicesKey,
  accountKey,
  addTokenKey,
  challengeKey,
  DeviceRecordSchema,
  deviceKey,
  getJson,
  inviteKey,
  pendingKey,
  setJson,
  sessionKey,
} from './records'

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

describe('key builders', () => {
  it('builds the exact namespaced keys from the constraints table', () => {
    expect(inviteKey('abc')).toBe('invite:abc')
    expect(accountKey('acc1')).toBe('account:acc1')
    expect(accountDevicesKey('acc1')).toBe('account:acc1:devices')
    expect(deviceKey('cred1')).toBe('device:cred1')
    expect(sessionKey('sess1')).toBe('session:sess1')
    expect(challengeKey('chal1')).toBe('wachal:chal1')
    expect(addTokenKey('tok1')).toBe('deviceadd:tok1')
    expect(pendingKey('pend1')).toBe('pending:pend1')
  })
})

describe('getJson', () => {
  it('returns null for a missing key', async () => {
    const ops = makeOps()
    const result = await getJson(ops, deviceKey('missing'), DeviceRecordSchema)
    expect(result).toBeNull()
  })

  it('returns an Error for malformed JSON', async () => {
    const ops = makeOps()
    await ops.set(deviceKey('bad'), '{not json')
    const result = await getJson(ops, deviceKey('bad'), DeviceRecordSchema)
    expect(result).toBeInstanceOf(Error)
  })

  it('returns an Error when the JSON does not match the schema', async () => {
    const ops = makeOps()
    await ops.set(deviceKey('wrong-shape'), JSON.stringify({ foo: 'bar' }))
    const result = await getJson(ops, deviceKey('wrong-shape'), DeviceRecordSchema)
    expect(result).toBeInstanceOf(Error)
  })
})

describe('setJson + getJson round-trip', () => {
  it('round-trips a DeviceRecord', async () => {
    const ops = makeOps()
    const record = {
      credentialId: 'cred1',
      publicKey: 'pubkey-b64url',
      signCount: 0,
      label: 'Board device',
      createdAt: 1_000,
      lastSeenAt: 1_000,
      disabled: false,
      accountId: 'acc1',
      status: 'active' as const,
      addedVia: 'invite' as const,
    }

    await setJson(ops, deviceKey('cred1'), record)
    const result = await getJson(ops, deviceKey('cred1'), DeviceRecordSchema)

    expect(result).toEqual(record)
  })

  it('forwards ttlMs to the underlying store', async () => {
    const ops = makeOps()
    const setSpy = { ttlMs: undefined as number | undefined }
    const originalSet = ops.set.bind(ops)
    ops.set = async (key, value, ttlMs) => {
      setSpy.ttlMs = ttlMs
      await originalSet(key, value, ttlMs)
    }

    await setJson(ops, pendingKey('pend1'), { foo: 'bar' }, 5_000)

    expect(setSpy.ttlMs).toBe(5_000)
  })
})
