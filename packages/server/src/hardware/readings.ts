import { type Measurement, MeasurementSchema } from '@modules/health/domain/measurement'
import type {
  GatewayReading,
  GatewayReadingsResponse,
  ReadingStatus,
} from '@shared/hardware/gateway-protocol'

import { ingestForAccount } from './health-access'
import { logHardwareFailure, type HardwareDeps } from './http'
import type { GatewayRecord } from './records'
import { getBindings, getHardware, updateHardware } from './store'

/** The measurement id of a hardware reading; a persistence contract (ledger de-duplication). */
export function measurementIdFor(
  hardwareId: string,
  scaleUserIndex: number,
  takenAt: number,
): string {
  return `${hardwareId}:${scaleUserIndex}:${takenAt}`
}

type Outcome = { status: ReadingStatus; stored?: { hardwareId: string; takenAt: number } }

/** One reading's outcome. Resolves to a value for every failure; never rejects. */
async function ingestOne(
  deps: HardwareDeps,
  gateway: GatewayRecord,
  reading: GatewayReading,
): Promise<Outcome> {
  const hardware = await getHardware(deps.ops, reading.hardwareId)
  if (hardware instanceof Error) return { status: 'failed' }
  if (hardware === null || hardware.gatewayId !== gateway.id) return { status: 'rejected' }

  const bindings = await getBindings(deps.ops, hardware.id)
  if (bindings instanceof Error) return { status: 'failed' }
  const binding = bindings.find((b) => b.index === reading.scaleUserIndex)
  if (binding === undefined) return { status: 'unbound' }

  const parsed = MeasurementSchema.safeParse({
    id: measurementIdFor(hardware.id, reading.scaleUserIndex, reading.takenAt),
    takenAt: reading.takenAt,
    metrics: reading.metrics,
    source: { kind: 'hardware', hardwareId: hardware.id, model: hardware.model },
  })
  if (!parsed.success) return { status: 'rejected' }
  const measurement: Measurement = parsed.data

  const ingested = await ingestForAccount(deps.ops, deps.now, binding.accountId, measurement)
  if (ingested instanceof Error) return { status: 'failed' }
  if (!ingested.stored) return { status: 'duplicate' }
  return { status: 'stored', stored: { hardwareId: hardware.id, takenAt: reading.takenAt } }
}

/**
 * Ingests a gateway's batch, in order, answering a status per reading; a failing reading never
 * fails its neighbours. Logs carry the `ref` and status only, never a value.
 */
export async function ingestReadings(
  deps: HardwareDeps,
  gateway: GatewayRecord,
  readings: GatewayReading[],
): Promise<GatewayReadingsResponse> {
  const results: GatewayReadingsResponse['results'] = []
  const newest = new Map<string, number>()
  for (const reading of readings) {
    const outcome = await ingestOne(deps, gateway, reading)
    results.push({ ref: reading.ref, status: outcome.status })
    if (outcome.status === 'failed') {
      console.error('hardware reading failed', { ref: reading.ref, status: outcome.status })
    }
    if (outcome.stored !== undefined) {
      const { hardwareId, takenAt } = outcome.stored
      newest.set(hardwareId, Math.max(newest.get(hardwareId) ?? 0, takenAt))
    }
  }

  let moved = false
  for (const [hardwareId, takenAt] of newest) {
    let advanced = false
    const updated = await updateHardware(deps.ops, hardwareId, (current) => {
      if (current.lastReadingAt !== null && current.lastReadingAt >= takenAt) return current
      advanced = true
      return { ...current, lastReadingAt: takenAt }
    }).catch((cause: unknown) =>
      cause instanceof Error ? cause : new Error('hardware update failed', { cause }),
    )
    if (updated instanceof Error) logHardwareFailure('lastReadingAt update', updated)
    else if (advanced) moved = true
  }
  if (moved) {
    const published = await deps.publish({ type: 'changed' })
    if (published instanceof Error) logHardwareFailure('readings publish', published)
  }
  return { results }
}
