import { action, computed, wrap } from '@reatom/core'
import { catsModule } from 'module-cats'
import { OFELIA_ID } from 'module-cats/domain/ids'
import type { WidgetModules } from 'widget-runtime'
import { reatomModule } from 'widget-sdk/modules/reatom-module'

export type StatsRow = { person: string; cleanings: number; debt: number }

/**
 * Wires the cats module and maps Ofelia's litter member statistics to rows. The numbers
 * themselves are computed by the module; nothing is calculated here.
 */
export function makeStatsView(modules: WidgetModules) {
  const handle = reatomModule({ modules, module: catsModule, name: 'ofeliaStats.module' })

  const rows = computed<StatsRow[] | null>(() => {
    const model = handle.model()?.litter(OFELIA_ID)
    const stats = model?.memberStats()
    if (!stats) return null
    return stats.map(({ person, cleanings, debt }) => ({ person, cleanings, debt }))
  }, 'ofeliaStats.rows')

  // The module loaded but its ledger or settings read failed and nothing is being
  // retried: without this the card waits on null numbers forever. Gated on the
  // numbers, not on the ledger: a failed settings read leaves the ledger loaded
  // and the numbers null. Only while the numbers have never loaded — a later
  // transient error must not replace them, the same rule as the duty card's
  // `loadFailed`.
  const loadFailed = computed(() => {
    const model = handle.model()?.litter(OFELIA_ID)
    if (!model) return false
    return model.memberStats() === null && !model.ledgerLoading() && model.loadError() !== null
  }, 'ofeliaStats.loadFailed')

  const retryLedger = action(async () => {
    const model = handle.model()?.litter(OFELIA_ID)
    if (!model) return
    await wrap(model.retryLedger())
  }, 'ofeliaStats.retryLedger')

  return { rows, error: handle.error, retry: handle.retry, loadFailed, retryLedger }
}
