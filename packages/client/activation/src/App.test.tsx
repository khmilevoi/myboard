// @vitest-environment jsdom
import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { App } from './App'
import { pathname, search } from './model/router'

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
})
