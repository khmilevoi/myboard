import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import { listAccountDeviceIds, removeDeviceFromAccount } from './accounts'
import { DeviceNotFoundError } from './errors'
import { type DeviceRecord, DeviceRecordSchema, deviceKey, getJson, setJson } from './records'
import { revokeAllSessionsForDevice } from './sessions'

const DEVICE_KEY_PREFIX = 'device:'

export async function storeDevice(
  ops: ValkeyOps,
  device: DeviceRecord,
  opts?: { ttlMs?: number },
): Promise<void> {
  await setJson(ops, deviceKey(device.credentialId), device, opts?.ttlMs)
}

export async function getDevice(
  ops: ValkeyOps,
  credentialId: string,
): Promise<DeviceRecord | DeviceNotFoundError | Error> {
  const record = await getJson(ops, deviceKey(credentialId), DeviceRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new DeviceNotFoundError()
  return record
}

export async function listDevices(ops: ValkeyOps, accountId: string): Promise<DeviceRecord[]> {
  const ids = await listAccountDeviceIds(ops, accountId)
  const devices: DeviceRecord[] = []
  for (const id of ids) {
    const record = await getDevice(ops, id)
    if (!(record instanceof Error)) devices.push(record)
  }
  return devices
}

export async function listAllDeviceCredentialIds(ops: ValkeyOps): Promise<string[]> {
  const keys = await ops.scanKeys(DEVICE_KEY_PREFIX)
  return keys.map((key) => key.slice(DEVICE_KEY_PREFIX.length))
}

export async function setDeviceStatus(
  ops: ValkeyOps,
  credentialId: string,
  status: 'active' | 'pending',
): Promise<DeviceRecord | DeviceNotFoundError | Error> {
  const record = await getDevice(ops, credentialId)
  if (record instanceof Error) return record

  const updated: DeviceRecord = { ...record, status }
  await storeDevice(ops, updated)
  return updated
}

export async function updateSignCount(
  ops: ValkeyOps,
  credentialId: string,
  signCount: number,
): Promise<void> {
  const record = await getDevice(ops, credentialId)
  if (record instanceof Error) return

  await storeDevice(ops, { ...record, signCount })
}

export async function revokeDevice(ops: ValkeyOps, credentialId: string): Promise<void> {
  // Share the device-key lock with login's getDevice -> verify -> updateSignCount
  // critical section (see handlers.ts postLoginVerify), so a concurrent login can't
  // resurrect a device that's being revoked.
  const record = await runExclusive(deviceKey(credentialId), async () => {
    const record = await getDevice(ops, credentialId)
    if (record instanceof Error) return null

    await ops.del(deviceKey(credentialId))
    return record
  })
  if (record === null) return

  await removeDeviceFromAccount(ops, record.accountId, credentialId)
  await revokeAllSessionsForDevice(ops, credentialId)
}
