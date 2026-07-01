import { describe, expect, it } from 'vitest'

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
})
