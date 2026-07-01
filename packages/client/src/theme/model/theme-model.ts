import { atom, computed, effect, wrap } from '@reatom/core'

import type { ResolvedTheme, ThemeMode } from '@/shared/theme/types'

import { resolveTheme } from './resolve-theme'
import { loadThemeMode, saveThemeMode } from './theme-storage'

export const themeMode = atom<ThemeMode>('system', 'theme.mode')
export const systemPrefersDark = atom(false, 'theme.systemPrefersDark')

export const resolvedTheme = computed(
  () => resolveTheme(themeMode(), systemPrefersDark()),
  'theme.resolved',
)

const themeInitialized = atom(false, 'theme.initialized')

function applyTheme(theme: ResolvedTheme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme

    const color = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
    let metaTag = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])')
    if (!metaTag) {
      metaTag = document.createElement('meta')
      metaTag.name = 'theme-color'
      document.head.appendChild(metaTag)
    }
    metaTag.content = color
  }
}

export function initTheme() {
  const stored = loadThemeMode()
  if (stored instanceof Error) {
    console.warn('Theme load failed:', stored.message)
  } else if (stored !== null) {
    themeMode.set(stored)
  }

  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark.set(mq.matches)
    mq.addEventListener(
      'change',
      wrap((event: MediaQueryListEvent) => systemPrefersDark.set(event.matches)),
    )
  }

  // Apply synchronously so first paint has the right theme (no reliance on effect timing).
  applyTheme(resolveTheme(themeMode(), systemPrefersDark()))
  themeInitialized.set(true)
}

// Keep <html data-theme> in sync with the resolved theme.
effect(() => {
  applyTheme(resolvedTheme())
}, 'theme.apply')

// Persist the user's mode after init (mirrors board-model persistence).
effect(() => {
  if (!themeInitialized()) return
  const result = saveThemeMode(themeMode())
  if (result instanceof Error) console.warn('Theme save failed:', result.message)
}, 'theme.persist')
