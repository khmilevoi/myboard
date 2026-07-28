import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { Header } from './Header'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Header', () => {
  it('renders brand, theme toggle and the add-widget control', () => {
    render(<Header />)
    expect(screen.getByText('board')).toBeInTheDocument()
    expect(screen.getByText('my')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Тема' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить виджет' })).toBeInTheDocument()
  })

  it('renders the account menu avatar', () => {
    render(<Header />)
    expect(screen.getByRole('button', { name: 'Аккаунт' })).toBeInTheDocument()
  })

  it('shows no environment badge in a production build', () => {
    // Vitest resolves __APP_ENV__ to 'production' (vite.config.ts branches on
    // process.env.VITEST), so this is the real default, not a stub.
    render(<Header />)
    expect(screen.queryByRole('status', { name: /Окружение/ })).not.toBeInTheDocument()
  })
})
