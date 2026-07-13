// @vitest-environment jsdom
import { context, urlAtom } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { activateRoute, addDeviceRoute } from './routes'

beforeEach(() => {
  window.history.replaceState(null, '', '/activate')
})
afterEach(() => context.reset())

describe('activation routes', () => {
  it('addDeviceRoute.go({ scan: "1" }) navigates to /add-device?scan=1', () => {
    addDeviceRoute.go({ scan: '1' })

    expect(urlAtom().pathname).toBe('/add-device')
    expect(urlAtom().search).toBe('?scan=1')
  })

  it('activateRoute.go({}) navigates back to /activate', () => {
    urlAtom.go('/add-device?scan=1')

    activateRoute.go({})

    expect(urlAtom().pathname).toBe('/activate')
  })
})
