import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { activeBoardId, boards } from '../model/board-storage'
import { AddWidgetMenu } from './AddWidgetMenu'

import styles from './AddWidgetMenu.module.css'

beforeEach(() => {
  context.reset()
  localStorage.clear()
  boards.set([
    {
      id: 'board-1',
      name: 'Карина',
      instances: [],
      layout: [],
    },
  ])
  activeBoardId.set('board-1')
})

async function openCatalog() {
  render(<AddWidgetMenu />)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить виджет' }))
  await screen.findByText('Каталог виджетов')
}

describe('AddWidgetMenu', () => {
  it('keeps an accessible label when the trigger collapses to icon-only mode', () => {
    render(<AddWidgetMenu />)

    const trigger = screen.getByRole('button', { name: 'Добавить виджет' })

    expect(trigger).toHaveAttribute('aria-label', 'Добавить виджет')
    expect(within(trigger).getByText('Добавить виджет')).toHaveClass(styles.triggerLabel)
  })

  it('opens the catalog and lists widgets with descriptions', async () => {
    await openCatalog()
    expect(screen.getByText('Часы')).toBeInTheDocument()
    expect(screen.getByText('Текущее время и дата')).toBeInTheDocument()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
  })

  it('closes the catalog when its add button is clicked', async () => {
    await openCatalog()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить: Часы' }))
    await waitFor(() => {
      expect(screen.queryByText('Каталог виджетов')).not.toBeInTheDocument()
    })
  })

  it('filters rows by the search query', async () => {
    await openCatalog()
    fireEvent.change(screen.getByPlaceholderText('Поиск виджетов'), {
      target: { value: 'очередь' },
    })
    await waitFor(() => {
      expect(screen.queryByText('Часы')).not.toBeInTheDocument()
    })
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
  })
})
