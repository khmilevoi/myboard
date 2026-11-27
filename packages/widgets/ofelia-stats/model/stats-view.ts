import { action, computed, wrap } from '@reatom/core'
import { catsModule } from 'module-cats'
import { makeLitterChoice } from 'module-cats/card-choice'
import type { StorageApi, WidgetModules } from 'widget-runtime'
import { reatomModule } from 'widget-sdk/modules/reatom-module'

export type StatsRow = { person: string; cleanings: number; debt: number }

export type StatsViewInput = {
  modules: WidgetModules
  /** The card's instance storage, server side: where its litter choice lives. */
  storage: StorageApi
}

/**
 * Wires the cats module and this card's litter choice, and maps the chosen litter's member
 * statistics to rows. The numbers themselves are computed by the module; nothing is calculated
 * here.
 */
export function makeStatsView({ modules, storage }: StatsViewInput) {
  const handle = reatomModule({ modules, module: catsModule, name: 'ofeliaStats.module' })
  const choice = makeLitterChoice({ model: handle.model, storage, name: 'ofeliaStats.card' })

  const rows = computed<StatsRow[] | null>(() => {
    const stats = choice.litter()?.memberStats()
    if (!stats) return null
    return stats.map(({ person, cleanings, debt }) => ({ person, cleanings, debt }))
  }, 'ofeliaStats.rows')

  /** The module loaded and offers no litter at all: no cat exists yet (ruling 10). */
  const empty = computed(() => choice.options()?.length === 0, 'ofeliaStats.empty')

  // The module loaded but its ledger or settings read failed and nothing is being
  // retried: without this the card waits on null numbers forever. Gated on the
  // numbers, not on the ledger: a failed settings read leaves the ledger loaded
  // and the numbers null. Only while the numbers have never loaded — a later
  // transient error must not replace them, the same rule as the duty card's
  // `loadFailed`.
  const loadFailed = computed(() => {
    const litter = choice.litter()
    if (!litter) return false
    return litter.memberStats() === null && !litter.ledgerLoading() && litter.loadError() !== null
  }, 'ofeliaStats.loadFailed')

  const retryLedger = action(async () => {
    const litter = choice.litter()
    if (!litter) return
    await wrap(litter.retryLedger())
  }, 'ofeliaStats.retryLedger')

  return { rows, empty, choice, error: handle.error, retry: handle.retry, loadFailed, retryLedger }
}

export type StatsView = ReturnType<typeof makeStatsView>
