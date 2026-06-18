// @vitest-environment jsdom
import { context } from '@reatom/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  closeAddWidgetMenu,
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
