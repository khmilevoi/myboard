import * as errore from 'errore'

import type { ThemeMode } from '@/shared/theme/types'

export const THEME_STORAGE_KEY = 'myboard.theme'

export class ThemeStorageError extends errore.createTaggedError({
  name: 'ThemeStorageError',
  message: 'Theme storage operation failed: $reason',
}) {}

const MODES: ThemeMode[] = ['light', 'dark', 'system']

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && (MODES as string[]).includes(value)
}

export function loadThemeMode(): ThemeStorageError | ThemeMode | null {
  const raw = errore.try({
    try: () => localStorage.getItem(THEME_STORAGE_KEY),
    catch: (cause) => new ThemeStorageError({ reason: 'read failed', cause }),
  })
  if (raw instanceof ThemeStorageError) return raw
  if (raw === null) return null
  if (!isThemeMode(raw))
    return new ThemeStorageError({ reason: 'stored value is not a theme mode' })
  return raw
}

export function saveThemeMode(mode: ThemeMode): ThemeStorageError | void {
  const result = errore.try({
    try: () => localStorage.setItem(THEME_STORAGE_KEY, mode),
    catch: (cause) => new ThemeStorageError({ reason: 'write failed', cause }),
  })
  if (result instanceof ThemeStorageError) return result
}
