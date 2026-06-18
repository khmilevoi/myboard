// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import { Header } from './Header'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Header', () => {
  it('renders brand, theme toggle and the add-widget control', () => {
    render(<Header />)
    expect(screen.getByText('myboard')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /theme/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add widget/i })).toBeInTheDocument()
  })
})
