// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { instances } from '../model/board-model'
import { AddWidgetMenu } from './AddWidgetMenu'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

async function openCatalog() {
  render(<AddWidgetMenu />)
  fireEvent.click(screen.getByRole('button', { name: 'Добавить виджет' }))
  await screen.findByText('Каталог виджетов')
}

describe('AddWidgetMenu', () => {
  it('opens the catalog and lists widgets with descriptions', async () => {
    await openCatalog()
    expect(screen.getByText('Часы')).toBeInTheDocument()
    expect(screen.getByText('Текущее время и дата')).toBeInTheDocument()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
  })

  it('adds a widget when its add button is clicked', async () => {
    await openCatalog()
    expect(instances()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Добавить: Часы' }))
    expect(instances()).toHaveLength(1)
    expect(instances()[0]?.typeId).toBe('clock')
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
