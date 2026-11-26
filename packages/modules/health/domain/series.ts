import type { Measurement } from './measurement'
import type { MetricKind } from './metrics'

/** Merge month ledgers: dedupe by id (first wins), filter by kind, sort by takenAt then id. */
export function mergeSeries(ledgers: Measurement[][], kind?: MetricKind): Measurement[] {
  const seen = new Set<string>()
  const out: Measurement[] = []
  for (const ledger of ledgers) {
    for (const m of ledger) {
      if (seen.has(m.id)) continue
      seen.add(m.id)
      if (kind && !m.metrics[kind]) continue
      out.push(m)
    }
  }
  return out.sort((a, b) => a.takenAt - b.takenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}
