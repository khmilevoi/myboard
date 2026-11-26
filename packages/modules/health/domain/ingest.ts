import type { WidgetServerStorage } from '@shared/widgets/contracts'

import { latestKey, monthKey } from './keys'
import { MeasurementLedgerSchema, MeasurementSchema, type Measurement } from './measurement'
import { METRIC_KINDS } from './metrics'

/**
 * Idempotent on `measurement.id`. Appends to the reading's month ledger, then advances
 * `latest/<kind>` for every kind in the reading only when it is newer than the stored one.
 */
export async function ingestMeasurement(
  storage: WidgetServerStorage,
  measurement: Measurement,
): Promise<Error | { stored: boolean }> {
  const key = monthKey(measurement.takenAt)
  const ledger = await storage.get(key, MeasurementLedgerSchema)
  if (ledger instanceof Error) return ledger
  if (ledger?.some((m) => m.id === measurement.id)) return { stored: false }

  const appended = await storage.append(key, measurement)
  if (appended instanceof Error) return appended

  for (const kind of METRIC_KINDS) {
    if (!measurement.metrics[kind]) continue
    const latest = await storage.get(latestKey(kind), MeasurementSchema)
    if (latest instanceof Error) return latest
    if (latest && latest.takenAt >= measurement.takenAt) continue
    const written = await storage.set(latestKey(kind), measurement)
    if (written instanceof Error) return written
  }
  return { stored: true }
}
