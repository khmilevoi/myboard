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

  // The module loaded but its ledger read failed and nothing is being retried:
  // without this the card waits on a null ledger forever. Only while the ledger
  // has never loaded — a later transient error must not replace loaded numbers,
  // the same rule as the duty card's `loadFailed`.
  const ledgerFailed = computed(() => {
    const model = handle.model()?.litter(OFELIA_ID)
    if (!model) return false
    return model.ledger() === null && !model.ledgerLoading() && model.ledgerError() !== null
  }, 'ofeliaStats.ledgerFailed')

  const retryLedger = action(async () => {
    const model = handle.model()?.litter(OFELIA_ID)
    if (!model) return
    await wrap(model.retryLedger())
  }, 'ofeliaStats.retryLedger')

  return { rows, error: handle.error, retry: handle.retry, ledgerFailed, retryLedger }
}
