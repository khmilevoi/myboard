import { action, atom, computed, reatomBoolean } from '@reatom/core'

import { widgetTypes, type WidgetType } from '@/widget-registry/model/registry'

export const isAddWidgetMenuOpen = reatomBoolean(false, 'board.addWidgetMenu.open')
export const catalogQuery = atom('', 'board.addWidgetMenu.query')

export const filteredWidgetTypes = computed<WidgetType[]>(() => {
  const query = catalogQuery().trim().toLowerCase()
  if (!query) return widgetTypes
  return widgetTypes.filter(
    (type) =>
      type.title.toLowerCase().includes(query) || type.description.toLowerCase().includes(query),
  )
}, 'board.addWidgetMenu.filtered')

export const openAddWidgetMenu = isAddWidgetMenuOpen.setTrue
export const toggleAddWidgetMenu = isAddWidgetMenuOpen.toggle

export const closeAddWidgetMenu = action(() => {
  isAddWidgetMenuOpen.setFalse()
  catalogQuery.set('')
}, 'board.addWidgetMenu.close')
