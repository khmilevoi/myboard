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

  it('shares radix-ui as a strict singleton, so a widget layer joins the host layer stack', () => {
    expect(federationShared()['radix-ui']).toMatchObject({ singleton: true, strictVersion: true })
  })

  it('resolves catalog: references to the real semver range', () => {
    const shared = federationShared()
    for (const [name, config] of Object.entries(shared)) {
      expect(config.requiredVersion, `${name} requiredVersion`).not.toContain('catalog')
      expect(config.requiredVersion, `${name} requiredVersion`).toMatch(/^[~^]?\d|^workspace:/)
    }
  })

  it('shares every module package as a strict singleton', () => {
    expect(federationShared()['module-notes']).toEqual({
      singleton: true,
      strictVersion: true,
      requiredVersion: '0.0.0',
    })
  })

  it('gives the board host and the widget remotes one shared list, with no opt-out', () => {
    // The host must provide every module, exactly as it provides widget-runtime. A host that
    // left modules out let the first widget remote to init supply the singleton from its own
    // bundle, which silently detached the host's Reatom actions from its UI.
    // @ts-expect-error -- federationShared takes no options
    federationShared({ includeModules: false })
    expect(Object.keys(federationShared())).toContain('module-notes')
  })
})
