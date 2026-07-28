import { describe, expect, it } from 'vitest'

import { envAccentCss } from './tokens'

describe('envAccentCss', () => {
  it('emits nothing for production', () => {
    expect(envAccentCss('production')).toBe('')
  })

  it('emits a light and a dark rule set for a branded environment', () => {
    const css = envAccentCss('dev')

    expect(css).toContain(":root:root[data-app-env='dev'] {")
    expect(css).toContain(":root:root[data-app-env='dev'][data-theme='dark'] {")
    expect(css).toContain('--primary: oklch(0.55 0.17 85)')
    expect(css).toContain('--primary-hover: oklch(0.49 0.17 85)')
    expect(css).toContain('--ring: oklch(0.55 0.17 85)')
    expect(css).toContain('--accent-soft: oklch(0.955 0.032 85)')
    expect(css).toContain('--env-badge-fg: oklch(0.5 0.15 85)')
    expect(css).toContain('--primary: oklch(0.675 0.155 85)')
    expect(css).toContain('--primary-hover: oklch(0.73 0.155 85)')
    expect(css).toContain('--accent-soft: oklch(0.315 0.06 85)')
  })

  it('doubles :root so the override outranks tokens.css in both themes', () => {
    // tokens.css declares `:root, :root[data-theme='light']` (0,2,0) and
    // `:root[data-theme='dark']` (0,2,0). A single `:root[data-app-env]` is
    // also (0,2,0), so the light override would tie and be decided by
    // stylesheet order -- and where Vite injects our <style> relative to the
    // bundled CSS link is an implementation detail. Doubling takes us to
    // (0,3,0) / (0,4,0), which wins unconditionally.
    for (const name of ['dev', 'branch', 'local'] as const) {
      expect(envAccentCss(name)).toContain(`:root:root[data-app-env='${name}']`)
      expect(envAccentCss(name)).not.toMatch(/(?<!:root):root\[data-app-env/)
    }
  })

  it('moves only the hue between environments', () => {
    expect(envAccentCss('branch')).toContain('--primary: oklch(0.55 0.17 345)')
    expect(envAccentCss('local')).toContain('--primary: oklch(0.55 0.17 190)')
  })
})
