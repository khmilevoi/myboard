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
  window.history.replaceState(null, '', '/activate')
})

describe('App routing', () => {
  it('renders the HOME login card at /activate with no token', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Вход в myboard' })).toBeInTheDocument()
  })

  it('renders the ACTIVATE card at /activate?token=abc', async () => {
    window.history.replaceState(null, '', '/activate?token=abc')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Активация устройства' })).toBeInTheDocument()
  })

  it('renders the NO-CODE card at /activate?token= (empty)', async () => {
    window.history.replaceState(null, '', '/activate?token=')

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Нужен код приглашения' })).toBeInTheDocument()
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
