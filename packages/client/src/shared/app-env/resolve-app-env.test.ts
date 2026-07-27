import { describe, expect, it } from 'vitest'

import { AppEnvError, isAppEnvName, resolveAppEnv } from './resolve-app-env'

describe('resolveAppEnv', () => {
  it('takes the fallback when the variable is absent or blank', () => {
    expect(resolveAppEnv(undefined, 'production')).toBe('production')
    expect(resolveAppEnv('', 'local')).toBe('local')
    expect(resolveAppEnv('   ', 'local')).toBe('local')
  })

  it('accepts every registry name and trims incidental whitespace', () => {
    expect(resolveAppEnv('dev', 'production')).toBe('dev')
    expect(resolveAppEnv('branch', 'production')).toBe('branch')
    expect(resolveAppEnv('local', 'production')).toBe('local')
    expect(resolveAppEnv(' production ', 'local')).toBe('production')
  })

  it('returns an error naming the value and every known environment', () => {
    // A typo in the deploy chain must never ship production branding onto a
    // stand — that is the exact failure this feature exists to prevent.
    const result = resolveAppEnv('prod', 'production')
    expect(result).toBeInstanceOf(AppEnvError)
    const message = (result as AppEnvError).message
    expect(message).toContain('prod')
    expect(message).toContain('production, dev, branch, local')
  })

  it('narrows registry names', () => {
    expect(isAppEnvName('branch')).toBe(true)
    expect(isAppEnvName('staging')).toBe(false)
  })
})
