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
})
