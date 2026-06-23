// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LabeledButtons } from './LabeledButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onUndo: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('LabeledButtons — State A (pending)', () => {
  it('shows primary + secondary actions', () => {
    const h = handlers()
    render(<LabeledButtons status="pending" canUndo={false} canForgive {...h} />)
    fireEvent.click(screen.getByRole('button', { name: 'Какашки убраны' }))
    expect(h.onConfirm).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'В долг' }))
    expect(h.onDebt).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Простить' }))
    expect(h.onForgive).toHaveBeenCalledOnce()
  })

  it('uses custom primaryLabel', () => {
    render(<LabeledButtons status="pending" canUndo={false} canForgive primaryLabel="Подтвердить уборку" {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
  })
})

describe('LabeledButtons — State B (confirmed)', () => {
  it('shows plaque + undo with disabled secondary', () => {
    const h = handlers()
    render(<LabeledButtons status="closed" canUndo canForgive={false} {...h} />)
    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить' }))
    expect(h.onUndo).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
  })

  it('shows "анду" note when showNotes is true', () => {
    render(<LabeledButtons status="closed" canUndo canForgive={false} showNotes {...handlers()} />)
    expect(screen.getByText(/анду/)).toBeInTheDocument()
  })

  it('hides "анду" note when showNotes is false', () => {
    render(<LabeledButtons status="closed" canUndo canForgive={false} {...handlers()} />)
    expect(screen.queryByText(/анду/)).not.toBeInTheDocument()
  })
})

describe('LabeledButtons — State C (inactive)', () => {
  it('disables all buttons', () => {
    render(<LabeledButtons status="pending" canUndo={false} canForgive inactive {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Простить' })).toBeDisabled()
  })
})
