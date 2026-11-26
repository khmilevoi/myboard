// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

vi.mock('./module-packages.generated', () => ({
  modulePackages: { 'module-notes': '0.0.0' },
}))

import { federationShared } from './federation-shared'

describe('federationShared', () => {
  it('marks the five runtime deps as strict singletons', () => {
    const shared = federationShared()

    for (const dep of ['react', 'react-dom', '@reatom/core', '@reatom/react', 'widget-runtime']) {
      expect(shared[dep]).toMatchObject({ singleton: true, strictVersion: true })
    }
  })

  it('does not put widget-sdk in the shared scope (it is consumed via subpaths)', () => {
    expect(federationShared()['widget-sdk']).toBeUndefined()
  })

  it('shares zod and errore as strict singletons', () => {
    const shared = federationShared()
    expect(Object.keys(shared)).toEqual(
      expect.arrayContaining([
        'react',
        'react-dom',
        '@reatom/core',
        '@reatom/react',
        'widget-runtime',
        'zod',
        'errore',
      ]),
    )
  })

  it('resolves catalog: references to the real semver range', () => {
    const shared = federationShared()
    for (const [name, config] of Object.entries(shared)) {
      expect(config.requiredVersion, `${name} requiredVersion`).not.toContain('catalog')
      expect(config.requiredVersion, `${name} requiredVersion`).toMatch(/^[~^]?\d|^workspace:/)
    }
  })

  it('shares every module package as a strict singleton by default', () => {
    expect(federationShared()['module-notes']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '0.0.0',
    })
  })

  it('leaves module packages out when includeModules is false', () => {
    expect(federationShared({ includeModules: false })['module-notes']).toBeUndefined()
  })
})
