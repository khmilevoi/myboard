// @vitest-environment jsdom
import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { initRouter, navigateInApp, pathname, search } from './router'

beforeEach(() => {
  window.history.replaceState(null, '', '/activate')
})
afterEach(() => context.reset())

describe('activation router', () => {
  it('navigateInApp pushes browser history and updates the reactive atoms', () => {
    navigateInApp('/add-device?scan=1')

    expect(location.pathname).toBe('/add-device')
    expect(pathname()).toBe('/add-device')
    expect(search()).toBe('?scan=1')
  })

  it('syncs the atoms on popstate', () => {
    initRouter()
    window.history.replaceState(null, '', '/add-device?scan=1')

    window.dispatchEvent(new PopStateEvent('popstate'))

    expect(pathname()).toBe('/add-device')
    expect(search()).toBe('?scan=1')
  })
})
