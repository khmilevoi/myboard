import { context } from '@reatom/core'
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { themeMode } from '@/theme/model/theme-model'

import { ThemeTogglePill } from './ThemeTogglePill'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('ThemeTogglePill', () => {
  it('renders a radio per mode inside the Тема group', () => {
    render(<ThemeTogglePill />)
    expect(screen.getByRole('radiogroup', { name: 'Тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Светлая тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Тёмная тема' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Как в системе' })).toBeInTheDocument()
  })

  it('sets the theme mode on click', () => {
    render(<ThemeTogglePill />)
    fireEvent.click(screen.getByRole('radio', { name: 'Тёмная тема' }))
    expect(themeMode()).toBe('dark')
  })
})
