import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { themeMode } from '../model/theme-model'
import { ThemeToggle } from './ThemeToggle'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('ThemeToggle', () => {
  it('renders a button per mode inside the Тема group', () => {
    render(<ThemeToggle />)
    expect(screen.getByRole('radiogroup', { name: 'Тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Светлая тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Тёмная тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Системная тема' })).toBeInTheDocument()
  })

  it('sets the theme mode on click', () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмная тема' }))
    expect(themeMode()).toBe('dark')
  })

  it('marks the active mode with aria-pressed', async () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмная тема' }))
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Тёмная тема' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    })
  })
})
