// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { initTheme, systemPrefersDark, themeMode } from './theme-model'
import { THEME_STORAGE_KEY } from './theme-storage'

function mockMatchMedia(matches: boolean) {
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() {
      return false
    },
  })) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  context.reset()
  localStorage.clear()
})
afterEach(() => localStorage.clear())

describe('theme model init', () => {
  it('reads the persisted mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockMatchMedia(false)
    initTheme()
    expect(themeMode()).toBe('dark')
  })

  it('reflects the system preference for prefers-color-scheme: dark', () => {
    mockMatchMedia(true)
    initTheme()
    expect(systemPrefersDark()).toBe(true)
  })

  it('applies data-theme to <html>', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    mockMatchMedia(false)
    initTheme()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
