import type { WidgetServerStorage } from '@shared/widgets/contracts'

import { latestKey, monthKey } from './keys'
import { MeasurementLedgerSchema, MeasurementSchema, type Measurement } from './measurement'
import { METRIC_KINDS } from './metrics'

/** Newest-wins: advance `latest/<kind>` for every kind in the reading, never move it backwards. */
async function advanceLatest(
  storage: WidgetServerStorage,
  measurement: Measurement,
): Promise<Error | void> {
  for (const kind of METRIC_KINDS) {
    if (!measurement.metrics[kind]) continue
    const latest = await storage.get(latestKey(kind), MeasurementSchema)
    if (latest instanceof Error) return latest
    if (latest && latest.takenAt >= measurement.takenAt) continue
    const written = await storage.set(latestKey(kind), measurement)
    if (written instanceof Error) return written
  }
}

/**
 * Idempotent on `measurement.id`: the ledger never grows for a known id. Appends to the reading's
 * month ledger, then advances `latest/<kind>`. A duplicate id still runs the latest advance, so a
 * retry heals a first attempt that failed after the append.
 */
export async function ingestMeasurement(
  storage: WidgetServerStorage,
  measurement: Measurement,
): Promise<Error | { stored: boolean }> {
  const key = monthKey(measurement.takenAt)
  const ledger = await storage.get(key, MeasurementLedgerSchema)
  if (ledger instanceof Error) return ledger
  const duplicate = ledger?.some((m) => m.id === measurement.id) ?? false

  if (!duplicate) {
    const appended = await storage.append(key, measurement)
    if (appended instanceof Error) return appended
  }

  const advanced = await advanceLatest(storage, measurement)
  if (advanced instanceof Error) return advanced
  return { stored: !duplicate }
}
