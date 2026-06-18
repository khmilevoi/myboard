// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { themeMode } from '../model/theme-model'
import { ThemeToggle } from './ThemeToggle'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('ThemeToggle', () => {
  it('renders a button per mode', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /system/i })).toBeInTheDocument()
  })

  it('sets the theme mode on click', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /dark/i }))
    expect(themeMode()).toBe('dark')
  })

  it('marks the active mode with aria-pressed', async () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('button', { name: /dark/i }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /dark/i })).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
