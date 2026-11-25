import { computed } from '@reatom/core'
import { ofeliaModule } from 'module-ofelia'
import type { WidgetModules } from 'widget-runtime'
import { reatomModule } from 'widget-sdk/modules/reatom-module'

export type StatsRow = { person: string; cleanings: number; debt: number }

/**
 * Wires the ofelia module and maps its member statistics to rows. The numbers
 * themselves are computed by the module; nothing is calculated here.
 */
export function makeStatsView(modules: WidgetModules) {
  const handle = reatomModule({ modules, module: ofeliaModule, name: 'ofeliaStats.module' })

  const rows = computed<StatsRow[] | null>(() => {
    const model = handle.model()
    const stats = model?.memberStats()
    if (!stats) return null
    return stats.map(({ person, cleanings, debt }) => ({ person, cleanings, debt }))
  }, 'ofeliaStats.rows')

  return { rows, error: handle.error, retry: handle.retry }
}
