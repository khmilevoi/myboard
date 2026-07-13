// @vitest-environment jsdom
import { context, urlAtom } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { activateRoute, addDeviceRoute, closeScan, recordScanReturn, scanReturn } from './routes'

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

describe('scanner return target', () => {
  it('closeScan returns to the recorded in-app location (token intact)', () => {
    urlAtom.go('/activate?token=abc')
    recordScanReturn()
    addDeviceRoute.go({ scan: '1' })
    expect(urlAtom().pathname).toBe('/add-device')

    closeScan()

    expect(urlAtom().pathname).toBe('/activate')
    expect(urlAtom().search).toBe('?token=abc')
    expect(scanReturn()).toBeNull()
  })

  it('closeScan falls back to home when nothing was recorded (external deep-link)', () => {
    urlAtom.go('/add-device?scan=1')

    closeScan()

    expect(urlAtom().pathname).toBe('/activate')
    expect(urlAtom().search).toBe('')
  })
})
