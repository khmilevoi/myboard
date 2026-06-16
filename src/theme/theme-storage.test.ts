// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { loadThemeMode, saveThemeMode, THEME_STORAGE_KEY, ThemeStorageError } from './theme-storage'

afterEach(() => localStorage.clear())

describe('theme storage', () => {
  it('returns null when nothing is stored', () => {
    expect(loadThemeMode()).toBeNull()
  })

  it('round-trips a theme mode', () => {
    expect(saveThemeMode('dark')).toBeUndefined()
    expect(loadThemeMode()).toBe('dark')
  })

  it('returns ThemeStorageError when the stored value is not a theme mode', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'purple')
    expect(loadThemeMode()).toBeInstanceOf(ThemeStorageError)
  })
})
