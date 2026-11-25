import type { WaterRecord } from './schemas'

export type WaterInterval = {
  startAt: number
  endAt: number
  volumeMl: number | null
  durationHours: number
  normalizedMlPerDay: number | null
  status: 'estimated' | 'unknown'
  reason: 'measured' | 'missing_observation' | 'unmeasured_loss' | 'invalid_balance'
}
type Baseline = {
  startAt: number
  availableMl: number | null
  unmeasuredLoss: boolean
  invalidBalance: boolean
}

export function computeWaterIntervals(records: WaterRecord[]): WaterInterval[] {
  return projectWaterRecords(records).intervals
}

/** Same replay serves display and write validation, including an open interval. */
export function projectWaterRecords(records: WaterRecord[]) {
  const result: WaterInterval[] = []
  const invalidRecordIds: string[] = []
  const cursor: { baseline: Baseline | null } = { baseline: null }
  for (const record of records.toSorted((a, b) => a.occurredAt - b.occurredAt)) {
    const previous = cursor.baseline
    const availableMl =
      previous?.availableMl === null || previous === null
        ? null
        : previous.availableMl - record.discardedMl
    const invalidBalance =
      (previous?.invalidBalance ?? false) || (availableMl !== null && availableMl < 0)
    if (
      !previous?.invalidBalance &&
      availableMl !== null &&
      (availableMl < 0 || (record.remainingMl !== null && record.remainingMl > availableMl))
    ) {
      invalidRecordIds.push(record.id)
    }
    const unmeasuredLoss = (previous?.unmeasuredLoss ?? false) || record.unmeasuredLoss
    const observes = record.remainingMl !== null || record.kind === 'replace'
    if (previous !== null && observes) {
      const difference =
        availableMl === null || record.remainingMl === null
          ? null
          : availableMl - record.remainingMl
      const reason: WaterInterval['reason'] =
        invalidBalance || (difference !== null && difference < 0)
          ? 'invalid_balance'
          : unmeasuredLoss
            ? 'unmeasured_loss'
            : difference === null
              ? 'missing_observation'
              : 'measured'
      const volumeMl = reason === 'measured' ? difference : null
      const elapsedMs = record.occurredAt - previous.startAt
      result.push({
        startAt: previous.startAt,
        endAt: record.occurredAt,
        volumeMl,
        durationHours: elapsedMs / 3_600_000,
        normalizedMlPerDay:
          volumeMl !== null && elapsedMs > 0 ? (volumeMl * 86_400_000) / elapsedMs : null,
        status: volumeMl === null ? 'unknown' : 'estimated',
        reason,
      })
    }
    // A replacement throws away ALL prior bowl state, even when no old
    // remainder was measured. The newly poured amount is a known baseline.
    if (record.kind === 'replace' || record.remainingMl !== null) {
      cursor.baseline = {
        startAt: record.occurredAt,
        availableMl:
          record.kind === 'replace' ? record.addedMl : (record.remainingMl ?? 0) + record.addedMl,
        unmeasuredLoss: false,
        invalidBalance: false,
      }
      continue
    }
    // An unobserved topup changes the mass balance, not the observation time.
    cursor.baseline = {
      startAt: previous?.startAt ?? record.occurredAt,
      availableMl: availableMl === null ? null : availableMl + record.addedMl,
      unmeasuredLoss,
      invalidBalance,
    }
  }
  return { intervals: result, invalidRecordIds }
}
