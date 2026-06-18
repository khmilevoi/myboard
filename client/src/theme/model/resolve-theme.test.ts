import { describe, expect, it } from 'vitest'
import { resolveTheme } from './resolve-theme'

describe('resolveTheme', () => {
  it('returns the explicit mode when not system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the system preference when mode is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
