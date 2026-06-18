import { reatomBoolean } from '@reatom/core'

export const isAddWidgetMenuOpen = reatomBoolean(false, 'board.addWidgetMenu.open')

export const openAddWidgetMenu = isAddWidgetMenuOpen.setTrue
export const closeAddWidgetMenu = isAddWidgetMenuOpen.setFalse
export const toggleAddWidgetMenu = isAddWidgetMenuOpen.toggle
