import { z } from 'zod'

import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import { getDevice } from './devices'
import { AccountNotFoundError, DeviceLimitError } from './errors'
import {
  type AccountRecord,
  AccountRecordSchema,
  accountDevicesKey,
  accountKey,
  getJson,
  setJson,
} from './records'
import { randomId } from './tokens'

const DEFAULT_DEVICE_LIMIT = 10

const IdListSchema = z.array(z.string())

export type CreateAccountOptions = {
  name: string
  inviteId: string
  deviceLimit?: number
}

export async function createAccount(
  ops: ValkeyOps,
  now: () => number,
  { name, inviteId, deviceLimit = DEFAULT_DEVICE_LIMIT }: CreateAccountOptions,
): Promise<AccountRecord> {
  const record: AccountRecord = {
    id: randomId(),
    name,
    createdAt: now(),
    inviteId,
    deviceLimit,
  }

  await setJson(ops, accountKey(record.id), record)
  await setJson(ops, accountDevicesKey(record.id), [])

  return record
}

export async function getAccount(
  ops: ValkeyOps,
  id: string,
): Promise<AccountRecord | AccountNotFoundError | Error> {
  const record = await getJson(ops, accountKey(id), AccountRecordSchema)
  if (record instanceof Error) return record
  if (record === null) return new AccountNotFoundError()
  return record
}

export async function listAccountDeviceIds(ops: ValkeyOps, accountId: string): Promise<string[]> {
  const ids = await getJson(ops, accountDevicesKey(accountId), IdListSchema)
  if (ids instanceof Error || ids === null) return []
  return ids
}

export type AddDeviceOptions = {
  countsAgainstLimit: boolean
}

export async function addDeviceToAccount(
  ops: ValkeyOps,
  accountId: string,
  credentialId: string,
  { countsAgainstLimit }: AddDeviceOptions,
): Promise<void | DeviceLimitError | Error> {
  return runExclusive(accountDevicesKey(accountId), async () => {
    const ids = await listAccountDeviceIds(ops, accountId)

    if (countsAgainstLimit) {
      const account = await getAccount(ops, accountId)
      if (account instanceof Error) return account

      if (!ids.includes(credentialId)) {
        let activeCount = 0
        for (const id of ids) {
          const device = await getDevice(ops, id)
          if (!(device instanceof Error) && device.status === 'active') activeCount++
        }
        if (activeCount + 1 > account.deviceLimit) return new DeviceLimitError()
      }
    }

    if (!ids.includes(credentialId)) {
      await setJson(ops, accountDevicesKey(accountId), [...ids, credentialId])
    }
  })
}

export async function removeDeviceFromAccount(
  ops: ValkeyOps,
  accountId: string,
  credentialId: string,
): Promise<void> {
  await runExclusive(accountDevicesKey(accountId), async () => {
    const ids = await listAccountDeviceIds(ops, accountId)
    await setJson(
      ops,
      accountDevicesKey(accountId),
      ids.filter((id) => id !== credentialId),
    )
  })
}
