// @vitest-environment jsdom
import { context } from '@reatom/core'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  catalogQuery,
  closeAddWidgetMenu,
  filteredWidgetTypes,
  isAddWidgetMenuOpen,
  openAddWidgetMenu,
  toggleAddWidgetMenu,
} from './add-widget-menu-model'

beforeEach(() => {
  context.reset()
})

describe('add widget menu model', () => {
  it('tracks menu visibility through Reatom actions', () => {
    expect(isAddWidgetMenuOpen()).toBe(false)

    openAddWidgetMenu()
    expect(isAddWidgetMenuOpen()).toBe(true)

    toggleAddWidgetMenu()
    expect(isAddWidgetMenuOpen()).toBe(false)

    toggleAddWidgetMenu()
    expect(isAddWidgetMenuOpen()).toBe(true)

    closeAddWidgetMenu()
    expect(isAddWidgetMenuOpen()).toBe(false)
  })
})

describe('catalog search model', () => {
  it('returns all widgets when the query is empty', () => {
    catalogQuery.set('')
    expect(filteredWidgetTypes().length).toBeGreaterThanOrEqual(2)
  })

  it('filters by title and description, case-insensitively', () => {
    catalogQuery.set('часы')
    expect(filteredWidgetTypes().map((t) => t.id)).toEqual(['clock'])

    catalogQuery.set('очередь')
    expect(filteredWidgetTypes().map((t) => t.id)).toEqual(['ofelia-poop-duty'])
  })

  it('clears the query when the menu closes', () => {
    catalogQuery.set('часы')
    closeAddWidgetMenu()
    expect(catalogQuery()).toBe('')
  })
})
