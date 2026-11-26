import type { MetricKind } from './metrics'

/**
 * Storage keys are a persistence contract: module storage prefixes `m:health:a:<accountId>:` onto
 * what is built here, and readings are stored under these exact shapes. Changing any of them
 * (the separators, the month format, the `latest/` prefix) silently orphans existing data.
 * Module code builds keys only through this file.
 */
export const PROFILE_KEY = 'profile'

export const MAX_RANGE_MONTHS = 60

/** Ledger key of the UTC month containing `takenAt`. */
export function monthKey(takenAt: number): string {
  const d = new Date(takenAt)
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `measurements/${d.getUTCFullYear()}-${month}`
}

export function latestKey(kind: MetricKind): string {
  return `latest/${kind}`
}

/** Ledger keys for every UTC month touched by `[from, to]`, inclusive, ascending. */
export function monthKeysInRange(from: number, to: number): string[] {
  const start = new Date(from)
  const end = new Date(to)
  let year = start.getUTCFullYear()
  let month = start.getUTCMonth()
  const lastIndex = end.getUTCFullYear() * 12 + end.getUTCMonth()
  const keys: string[] = []
  while (year * 12 + month <= lastIndex) {
    keys.push(monthKey(Date.UTC(year, month, 1)))
    month += 1
    if (month === 12) {
      month = 0
      year += 1
    }
  }
  return keys
}
