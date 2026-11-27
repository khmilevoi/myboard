// @vitest-environment jsdom
import { context } from '@reatom/core'
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { App } from './App'
import { addDeviceRoute } from './model/routes'

// Stub the QR scanner screen: its real `useZxing` touches camera APIs and
// crashes under jsdom. The stub lets us assert the router lands on the
// add-device page without mounting the scanner.
vi.mock('./ui/AddDeviceScreen', () => ({
  AddDeviceScreen: () => <div>ADD DEVICE STUB</div>,
}))

beforeEach(() => {
  context.reset()
  vi.unstubAllGlobals()
  window.history.replaceState(null, '', '/activate')
})

describe('App routing', () => {
  it('renders the HOME login card at /activate with no token', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('opens /activate?token=abc on the invite check', async () => {
    window.history.replaceState(null, '', '/activate?token=abc')
    // The route loader starts the invite check; keep it pending so the test
    // never reaches a real server.
    vi.stubGlobal('fetch', () => new Promise(() => {}))

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Проверяем приглашение…' }),
    ).toBeInTheDocument()
  })

  it('renders the NO-CODE card at /activate?token= (empty)', async () => {
    window.history.replaceState(null, '', '/activate?token=')

    render(<App />)

    expect(
      await screen.findByRole('heading', { name: 'Нужен код приглашения' }),
    ).toBeInTheDocument()
  })

  it('switches to the add-device page via addDeviceRoute.go without remounting', async () => {
    render(<App />)
    await screen.findByRole('heading', { name: 'Вход в myboard' })

    act(() => {
      addDeviceRoute.go({ scan: '1' })
    })

    expect(await screen.findByText('ADD DEVICE STUB')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Вход в myboard' })).not.toBeInTheDocument()
  })
})
