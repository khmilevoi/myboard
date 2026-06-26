import { fireEvent, render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'

import { BoardSchemaSelect } from './BoardSchemaSelect'

const items = [
  { id: 'main', name: 'Главная' },
  { id: 'work', name: 'Рабочая' },
]

describe('BoardSchemaSelect', () => {
  const currentBoardTrigger = 'Текущая схема: Главная'

  it('renders a loading skeleton', () => {
    render(<BoardSchemaSelect items={[]} value={null} isLoading />)

    expect(screen.getByLabelText('Загрузка схем борды')).toBeInTheDocument()
  })

  it('emits the selected board schema id', () => {
    const onValueChange = vi.fn()

    render(<BoardSchemaSelect items={items} value="main" onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('button', { name: currentBoardTrigger }))
    fireEvent.click(screen.getByRole('button', { name: 'Рабочая' }))

    expect(onValueChange).toHaveBeenCalledWith('work')
  })

  it('emits a new board schema name', () => {
    const onCreate = vi.fn()

    render(<BoardSchemaSelect items={items} value="main" onCreate={onCreate} />)

    fireEvent.click(screen.getByRole('button', { name: currentBoardTrigger }))
    fireEvent.change(screen.getByLabelText('Название новой схемы'), {
      target: { value: ' Дом ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Добавить схему' }))

    expect(onCreate).toHaveBeenCalledWith('Дом')
  })

  it('emits a renamed board schema', () => {
    const onRename = vi.fn()

    render(<BoardSchemaSelect items={items} value="main" onRename={onRename} />)

    fireEvent.click(screen.getByRole('button', { name: currentBoardTrigger }))
    fireEvent.click(screen.getByRole('button', { name: 'Переименовать схему Главная' }))
    fireEvent.change(screen.getByLabelText('Новое имя схемы Главная'), {
      target: { value: ' Личная ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить имя схемы' }))

    expect(onRename).toHaveBeenCalledWith('main', 'Личная')
  })

  it('emits a deleted board schema id', () => {
    const onDelete = vi.fn()

    render(<BoardSchemaSelect items={items} value="main" onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: currentBoardTrigger }))
    fireEvent.click(screen.getByRole('button', { name: 'Удалить схему Рабочая' }))

    expect(onDelete).toHaveBeenCalledWith('work')
  })
})
