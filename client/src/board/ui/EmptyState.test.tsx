import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { isAddWidgetMenuOpen } from '../model/add-widget-menu-model'
import { EmptyState } from './EmptyState'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('EmptyState', () => {
  it('renders the onboarding heading and action', () => {
    render(<EmptyState />)
    expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить виджет' })).toBeInTheDocument()
  })

  it('opens the catalog from the primary action', () => {
    render(<EmptyState />)
    expect(isAddWidgetMenuOpen()).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить виджет' }))
    expect(isAddWidgetMenuOpen()).toBe(true)
  })
})
