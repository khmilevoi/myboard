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

  // Both controls are always in the DOM -- CSS media queries pick which one
  // is visible, and jsdom never evaluates them -- so the cycling button's
  // accessible name must not collide with any 'radio' name above, or these
  // getByRole('radio', ...) queries above would themselves start throwing
  // "found multiple elements". It's role 'button' vs their role 'radio', so
  // there's no collision even where the composed name embeds the same mode
  // label text.
  it('also renders the compact cycling button, naming the current mode', () => {
    render(<ThemeToggle />)
    // Default mode is 'system' (see theme-model.ts), so this is the initial
    // composed name -- matched via regex below the mode changes.
    expect(
      screen.getByRole('button', { name: 'Тема: Системная тема. Сменить' }),
    ).toBeInTheDocument()
  })

  it("names the cycling button's accessible name after the current mode, not a fixed label", async () => {
    render(<ThemeToggle />)
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмная тема' }))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Тема: Тёмная тема. Сменить' })).toBeInTheDocument()
    })
  })

  it('walks light -> dark -> system -> light as the cycling button is clicked repeatedly', () => {
    render(<ThemeToggle />)
    // The accessible name changes with the mode, so query by role + a regex
    // that survives every mode instead of grabbing a stale exact-name node.
    const getCycleButton = () => screen.getByRole('button', { name: /Сменить$/ })

    fireEvent.click(screen.getByRole('radio', { name: 'Светлая тема' }))
    expect(themeMode()).toBe('light')

    fireEvent.click(getCycleButton())
    expect(themeMode()).toBe('dark')

    fireEvent.click(getCycleButton())
    expect(themeMode()).toBe('system')

    fireEvent.click(getCycleButton())
    expect(themeMode()).toBe('light')
  })
})
