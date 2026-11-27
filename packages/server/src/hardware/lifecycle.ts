import { randomUUID } from 'node:crypto'

import type { HardwareBoardEvent, PairingStage, ScanResult } from '@shared/hardware/board-api'
import type { BleAddress, HardwareModel } from '@shared/hardware/models'
import { SCAN_DURATION_MS } from '@shared/hardware/spike-assumptions'

import { getJson, setJson } from '../auth/records'
import { runExclusive } from '../storage/key-lock'
import {
  BondUnknownError,
  GatewayNotFoundError,
  GatewayOfflineError,
  HardwareExistsError,
  HardwareNotFoundError,
  PairingNotFoundError,
  PairingNotWaitingPinError,
  ScanResultUnknownError,
} from './errors'
import { type HardwareDeps, logHardwareFailure } from './http'
import { addressLockKey, pairingKey, scanKey } from './keys'
import { sendPendingUpdates, syncBindings } from './profile-sync'
import {
  type HardwareRecord,
  type PairingRecord,
  PairingRecordSchema,
  type ScanRecord,
  ScanRecordSchema,
} from './records'
import {
  deleteHardware,
  getGateway,
  getHardware,
  listHardware,
  putHardware,
  updateHardware,
} from './store'

export const PAIRING_TTL_MS = 3 * 60_000
export const SCAN_RECORD_TTL_MS = SCAN_DURATION_MS + 60_000

/** The write already happened, so a missed board refresh is logged, never failed. */
async function announce(deps: HardwareDeps, event: HardwareBoardEvent, context: string) {
  const published = await deps.publish(event)
  if (published instanceof Error) logHardwareFailure(`${context} publish`, published)
}

/**
 * The gateway learns its bindings, then every profile update it has not acknowledged: a relinked
 * scale may carry a change made while it was detached, which nothing else would send until the
 * gateway reconnects.
 */
async function syncAfter(deps: HardwareDeps, gatewayId: string, context: string) {
  const synced = await syncBindings(deps, gatewayId)
  if (synced instanceof Error) logHardwareFailure(`${context} sync`, synced)
  const updated = await sendPendingUpdates(deps, gatewayId)
  if (updated instanceof Error) logHardwareFailure(`${context} updates`, updated)
}

/** The gateway record, or the error to answer; also requires its stream to be open. */
async function onlineGateway(deps: HardwareDeps, gatewayId: string) {
  const gateway = await getGateway(deps.ops, gatewayId)
  if (gateway instanceof Error) return gateway
  if (gateway === null) return new GatewayNotFoundError()
  if (!deps.connections.isOnline(gatewayId)) return new GatewayOfflineError()
  return gateway
}

// ---- Scan ----

/** Rewrites the scan record under its lock; `null` when none exists (expired or never started). */
async function updateScan(
  deps: HardwareDeps,
  gatewayId: string,
  update: (current: ScanRecord) => ScanRecord,
): Promise<ScanRecord | null | Error> {
  return runExclusive(scanKey(gatewayId), async () => {
    const current = await getJson(deps.ops, scanKey(gatewayId), ScanRecordSchema)
    if (current instanceof Error || current === null) return current
    const next = update(current)
    await setJson(deps.ops, scanKey(gatewayId), next, SCAN_RECORD_TTL_MS)
    return next
  })
}

export async function startScan(deps: HardwareDeps, gatewayId: string): Promise<void | Error> {
  const gateway = await onlineGateway(deps, gatewayId)
  if (gateway instanceof Error) return gateway
  const record: ScanRecord = { gatewayId, startedAt: deps.now(), active: true, results: [] }
  await runExclusive(scanKey(gatewayId), () =>
    setJson(deps.ops, scanKey(gatewayId), record, SCAN_RECORD_TTL_MS),
  )
  const sent = deps.connections.send(gatewayId, {
    id: randomUUID(),
    type: 'scan.start',
    durationMs: SCAN_DURATION_MS,
  })
  if (!sent) return new GatewayOfflineError()
  await announce(deps, { type: 'changed' }, 'scan start')
}

export async function stopScan(deps: HardwareDeps, gatewayId: string): Promise<void | Error> {
  const gateway = await onlineGateway(deps, gatewayId)
  if (gateway instanceof Error) return gateway
  const stopped = await updateScan(deps, gatewayId, (current) => ({ ...current, active: false }))
  if (stopped instanceof Error) return stopped
  const sent = deps.connections.send(gatewayId, { id: randomUUID(), type: 'scan.stop' })
  if (!sent) return new GatewayOfflineError()
  await announce(deps, { type: 'changed' }, 'scan stop')
}

/** Gateway event `scan.result`: deduped by address, the latest wins. Errors make the gateway resend. */
export async function recordScanResult(
  deps: HardwareDeps,
  gatewayId: string,
  result: ScanResult,
): Promise<void | Error> {
  const updated = await updateScan(deps, gatewayId, (current) => ({
    ...current,
    results: [...current.results.filter((item) => item.address !== result.address), result],
  }))
  if (updated instanceof Error) return updated
  if (updated === null) return
  return deps.publish({ type: 'scan.result', gatewayId, result })
}

/** Gateway event `scan.finished`. */
export async function finishScan(deps: HardwareDeps, gatewayId: string): Promise<void | Error> {
  const updated = await updateScan(deps, gatewayId, (current) => ({ ...current, active: false }))
  if (updated instanceof Error) return updated
  if (updated === null) return
  return deps.publish({ type: 'scan.finished', gatewayId })
}

// ---- Pairing ----

export async function startPairing(
  deps: HardwareDeps,
  gatewayId: string,
  address: BleAddress,
): Promise<{ pairingId: string } | Error> {
  const gateway = await onlineGateway(deps, gatewayId)
  if (gateway instanceof Error) return gateway
  const scan = await getJson(deps.ops, scanKey(gatewayId), ScanRecordSchema)
  if (scan instanceof Error) return scan
  const found = scan?.results.find((item) => item.address === address)
  if (found === undefined) return new ScanResultUnknownError()
  const all = await listHardware(deps.ops)
  if (all instanceof Error) return all
  if (all.some((item) => item.gatewayId === gatewayId && item.address === address)) {
    return new HardwareExistsError()
  }

  const pairingId = randomUUID()
  const record: PairingRecord = {
    id: pairingId,
    gatewayId,
    address,
    model: found.model,
    stage: 'connecting',
    hardwareId: null,
  }
  await setJson(deps.ops, pairingKey(pairingId), record, PAIRING_TTL_MS)
  const sent = deps.connections.send(gatewayId, {
    id: randomUUID(),
    type: 'pair',
    pairingId,
    address,
    model: found.model,
  })
  if (!sent) {
    await deps.ops.del(pairingKey(pairingId))
    return new GatewayOfflineError()
  }
  await announce(
    deps,
    { type: 'pairing', pairingId, stage: 'connecting', hardwareId: null, reason: null },
    'pairing start',
  )
  return { pairingId }
}

/** The PIN is forwarded to the gateway and never stored or logged. */
export async function submitPairingPin(
  deps: HardwareDeps,
  pairingId: string,
  pin: string,
): Promise<void | Error> {
  const pairing = await getJson(deps.ops, pairingKey(pairingId), PairingRecordSchema)
  if (pairing instanceof Error) return pairing
  if (pairing === null) return new PairingNotFoundError()
  if (pairing.stage !== 'pin_required' && pairing.stage !== 'pin_rejected') {
    return new PairingNotWaitingPinError()
  }
  const gateway = await onlineGateway(deps, pairing.gatewayId)
  if (gateway instanceof Error) return gateway
  const sent = deps.connections.send(pairing.gatewayId, {
    id: randomUUID(),
    type: 'pairing.pin',
    pairingId,
    pin,
  })
  if (!sent) return new GatewayOfflineError()
}

/**
 * The hardware of `address` on this gateway: the one already there, a detached one of the same
 * model relinked (its bindings are kept), else a new record. Serialized per address.
 */
async function relinkOrMakeHardware(
  deps: HardwareDeps,
  gatewayId: string,
  address: BleAddress,
  model: HardwareModel,
): Promise<HardwareRecord | Error> {
  return runExclusive(addressLockKey(address), async () => {
    const all = await listHardware(deps.ops)
    if (all instanceof Error) return all
    const existing = all.find((item) => item.address === address && item.gatewayId === gatewayId)
    if (existing !== undefined) return existing
    const detached = all.find(
      (item) => item.address === address && item.gatewayId === null && item.model === model,
    )
    if (detached !== undefined) {
      const relinked = await updateHardware(deps.ops, detached.id, (current) => ({
        ...current,
        gatewayId,
      }))
      if (relinked instanceof Error) return relinked
      if (relinked !== null) return relinked
    }
    const made: HardwareRecord = {
      id: randomUUID(),
      gatewayId,
      address,
      model,
      createdAt: deps.now(),
      battery: null,
      lastReadingAt: null,
      scaleUsers: [],
    }
    const put = await putHardware(deps.ops, made)
    if (put instanceof Error) return put
    return made
  })
}

/** Gateway event `pairing.progress`. A repeated `bonded` neither duplicates nor republishes. */
export async function applyPairingProgress(
  deps: HardwareDeps,
  gatewayId: string,
  progress: { pairingId: string; stage: Exclude<PairingStage, 'connecting'>; reason?: string },
): Promise<void | Error> {
  const outcome = await runExclusive(pairingKey(progress.pairingId), async () => {
    const current = await getJson(deps.ops, pairingKey(progress.pairingId), PairingRecordSchema)
    if (current instanceof Error) return current
    // Expired, unknown, or another gateway's pairing; or already bonded.
    if (current === null || current.gatewayId !== gatewayId) return null
    if (current.stage === 'bonded') return null
    let hardwareId: string | null = null
    if (progress.stage === 'bonded') {
      const hardware = await relinkOrMakeHardware(deps, gatewayId, current.address, current.model)
      if (hardware instanceof Error) return hardware
      hardwareId = hardware.id
    }
    await setJson(
      deps.ops,
      pairingKey(progress.pairingId),
      { ...current, stage: progress.stage, hardwareId },
      PAIRING_TTL_MS,
    )
    return { hardwareId }
  })
  if (outcome instanceof Error) return outcome
  if (outcome === null) return
  // A relinked detached record keeps its bindings: the gateway must learn them. Done before the
  // publishes, because a resent `bonded` is a no-op and would not sync again.
  if (progress.stage === 'bonded') await syncAfter(deps, gatewayId, 'pairing bonded')
  const published = await deps.publish({
    type: 'pairing',
    pairingId: progress.pairingId,
    stage: progress.stage,
    hardwareId: outcome.hardwareId,
    reason: progress.reason ?? null,
  })
  if (published instanceof Error) return published
  if (progress.stage === 'bonded') return deps.publish({ type: 'changed' })
}

// ---- Adopt / unpair ----

export async function adoptHardware(
  deps: HardwareDeps,
  gatewayId: string,
  address: BleAddress,
): Promise<{ hardwareId: string } | Error> {
  const gateway = await onlineGateway(deps, gatewayId)
  if (gateway instanceof Error) return gateway
  const bond = gateway.bonded.find((item) => item.address === address)
  if (bond === undefined) return new BondUnknownError()
  const all = await listHardware(deps.ops)
  if (all instanceof Error) return all
  if (all.some((item) => item.gatewayId === gatewayId && item.address === address)) {
    return new HardwareExistsError()
  }
  const hardware = await relinkOrMakeHardware(deps, gatewayId, address, bond.model)
  if (hardware instanceof Error) return hardware
  await announce(deps, { type: 'changed' }, 'adopt')
  await syncAfter(deps, gatewayId, 'adopt')
  return { hardwareId: hardware.id }
}

export async function unpairHardware(
  deps: HardwareDeps,
  hardwareId: string,
): Promise<void | Error> {
  const hardware = await getHardware(deps.ops, hardwareId)
  if (hardware instanceof Error) return hardware
  if (hardware === null) return new HardwareNotFoundError()
  const gatewayId = hardware.gatewayId
  if (gatewayId !== null) {
    const sent = deps.connections.send(gatewayId, {
      id: randomUUID(),
      type: 'unpair',
      hardwareId,
      address: hardware.address,
    })
    if (!sent) return new GatewayOfflineError()
  }
  const deleted = await deleteHardware(deps.ops, hardwareId)
  if (deleted instanceof Error) return deleted
  await announce(deps, { type: 'changed' }, 'unpair')
  if (gatewayId !== null) await syncAfter(deps, gatewayId, 'unpair')
}
