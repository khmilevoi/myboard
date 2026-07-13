// @vitest-environment jsdom
import { context, notify } from '@reatom/core'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { navigateInApp, pathname, search } from './model/router'

// Stub the QR scanner screen: its real `useZxing` touches camera APIs and
// crashes under jsdom. The stub lets us assert the router branch flips to the
// add-device screen without mounting the scanner.
vi.mock('./ui/AddDeviceScreen', () => ({
  AddDeviceScreen: () => <div>ADD DEVICE STUB</div>,
}))

beforeEach(() => context.reset())

describe('App routing', () => {
  it('renders the HOME login card at the board root (no token)', () => {
    window.history.replaceState(null, '', '/')
    pathname.set('/')
    search.set('')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('renders the ACTIVATE card when a token is present', () => {
    window.history.replaceState(null, '', '/activate?token=abc')
    pathname.set('/activate')
    search.set('?token=abc')

    render(<App />)

    expect(screen.getByRole('heading', { name: 'Активация устройства' })).toBeInTheDocument()
  })

  it('re-renders reactively when the router pathname changes (no remount)', () => {
    window.history.replaceState(null, '', '/')
    pathname.set('/')
    search.set('')

    render(<App />)

    // Initial branch: HOME login card.
    expect(screen.getByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()

    // Move to /add-device via the real in-app router (pushState + pathname.set),
    // WITHOUT remounting <App />. `notify()` flushes the reatom microtask
    // synchronously (mirroring the goHome handler) and `act` keeps the output
    // pristine. Only a component subscribed to the `pathname` atom re-renders
    // here -- code that read `location.pathname` once would stay on HOME.
    act(() => {
      navigateInApp('/add-device')
      notify()
    })

    expect(screen.getByText('ADD DEVICE STUB')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Вход в myboard' })).not.toBeInTheDocument()
  })
})
