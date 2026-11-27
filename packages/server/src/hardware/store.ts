import { z } from 'zod'

import { getJson, setJson } from '../auth/records'
import { runExclusive } from '../storage/key-lock'
import type { ValkeyOps } from '../storage/valkey'
import { bindingsKey, GATEWAY_IDS_KEY, gatewayKey, HARDWARE_IDS_KEY, hardwareKey } from './keys'
import {
  type BindingRecord,
  BindingRecordSchema,
  type GatewayRecord,
  GatewayRecordSchema,
  type HardwareRecord,
  HardwareRecordSchema,
} from './records'

const IdListSchema = z.array(z.string())
const BindingListSchema = z.array(BindingRecordSchema)

async function readIds(ops: ValkeyOps, indexKey: string) {
  const ids = await getJson(ops, indexKey, IdListSchema)
  if (ids instanceof Error) return ids
  return ids ?? []
}

function addId(ops: ValkeyOps, indexKey: string, id: string): Promise<void | Error> {
  return runExclusive(indexKey, async () => {
    const ids = await readIds(ops, indexKey)
    if (ids instanceof Error) return ids
    if (ids.includes(id)) return
    await setJson(ops, indexKey, [...ids, id])
  })
}

function removeId(ops: ValkeyOps, indexKey: string, id: string): Promise<void | Error> {
  return runExclusive(indexKey, async () => {
    const ids = await readIds(ops, indexKey)
    if (ids instanceof Error) return ids
    if (!ids.includes(id)) return
    const next = ids.filter((existing) => existing !== id)
    if (next.length === 0) await ops.del(indexKey)
    else await setJson(ops, indexKey, next)
  })
}

async function listRecords<T>(
  ops: ValkeyOps,
  indexKey: string,
  load: (id: string) => Promise<T | null | Error>,
): Promise<T[] | Error> {
  const ids = await readIds(ops, indexKey)
  if (ids instanceof Error) return ids
  const loaded = await Promise.all(ids.map(load))
  const out: T[] = []
  for (const record of loaded) {
    if (record instanceof Error) return record
    if (record !== null) out.push(record)
  }
  return out
}

export function getGateway(ops: ValkeyOps, id: string): Promise<GatewayRecord | null | Error> {
  return getJson(ops, gatewayKey(id), GatewayRecordSchema)
}

export async function putGateway(ops: ValkeyOps, record: GatewayRecord): Promise<void | Error> {
  await setJson(ops, gatewayKey(record.id), record)
  return addId(ops, GATEWAY_IDS_KEY, record.id)
}

export function updateGateway(
  ops: ValkeyOps,
  id: string,
  update: (current: GatewayRecord) => GatewayRecord | Error,
): Promise<GatewayRecord | null | Error> {
  return runExclusive(gatewayKey(id), async () => {
    const current = await getGateway(ops, id)
    if (current instanceof Error || current === null) return current
    const next = update(current)
    if (next instanceof Error) return next
    await setJson(ops, gatewayKey(id), next)
    return next
  })
}

export async function deleteGateway(ops: ValkeyOps, id: string): Promise<void | Error> {
  await ops.del(gatewayKey(id))
  return removeId(ops, GATEWAY_IDS_KEY, id)
}

export function listGateways(ops: ValkeyOps): Promise<GatewayRecord[] | Error> {
  return listRecords(ops, GATEWAY_IDS_KEY, (id) => getGateway(ops, id))
}

export function getHardware(ops: ValkeyOps, id: string): Promise<HardwareRecord | null | Error> {
  return getJson(ops, hardwareKey(id), HardwareRecordSchema)
}

export async function putHardware(ops: ValkeyOps, record: HardwareRecord): Promise<void | Error> {
  await setJson(ops, hardwareKey(record.id), record)
  return addId(ops, HARDWARE_IDS_KEY, record.id)
}

export function updateHardware(
  ops: ValkeyOps,
  id: string,
  update: (current: HardwareRecord) => HardwareRecord | Error,
): Promise<HardwareRecord | null | Error> {
  return runExclusive(hardwareKey(id), async () => {
    const current = await getHardware(ops, id)
    if (current instanceof Error || current === null) return current
    const next = update(current)
    if (next instanceof Error) return next
    await setJson(ops, hardwareKey(id), next)
    return next
  })
}

export async function deleteHardware(ops: ValkeyOps, id: string): Promise<void | Error> {
  await ops.del(hardwareKey(id))
  await runExclusive(bindingsKey(id), () => ops.del(bindingsKey(id)))
  return removeId(ops, HARDWARE_IDS_KEY, id)
}

export function listHardware(ops: ValkeyOps): Promise<HardwareRecord[] | Error> {
  return listRecords(ops, HARDWARE_IDS_KEY, (id) => getHardware(ops, id))
}

export async function getBindings(
  ops: ValkeyOps,
  hardwareId: string,
): Promise<BindingRecord[] | Error> {
  const list = await getJson(ops, bindingsKey(hardwareId), BindingListSchema)
  if (list instanceof Error) return list
  return list ?? []
}

export function updateBindings(
  ops: ValkeyOps,
  hardwareId: string,
  update: (current: BindingRecord[]) => BindingRecord[] | Error,
): Promise<void | Error> {
  const key = bindingsKey(hardwareId)
  return runExclusive(key, async () => {
    const current = await getBindings(ops, hardwareId)
    if (current instanceof Error) return current
    const next = update(current)
    if (next instanceof Error) return next
    if (next.length === 0) await ops.del(key)
    else await setJson(ops, key, next)
  })
}
