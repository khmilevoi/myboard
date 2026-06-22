// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActionButtons } from './ActionButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onUndo: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('ActionButtons (full)', () => {
  it('shows confirm + secondary actions when the day is pending', () => {
    const h = handlers()
    render(<ActionButtons status="pending" canUndo={false} canForgive {...h} />)

    fireEvent.click(screen.getByRole('button', { name: 'Какашки убраны' }))
    expect(h.onConfirm).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'В долг' }))
    expect(h.onDebt).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Простить' }))
    expect(h.onForgive).toHaveBeenCalledOnce()
  })

  it('hides "Простить" when there is no debt to forgive', () => {
    render(<ActionButtons status="pending" canUndo={false} canForgive={false} {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Простить' })).not.toBeInTheDocument()
  })

  it('shows the confirmed plaque with undo when closed and undoable', () => {
    const h = handlers()
    render(<ActionButtons status="closed" canUndo canForgive={false} {...h} />)

    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Откатить' }))
    expect(h.onUndo).toHaveBeenCalledOnce()
  })

  it('omits the undo button when closed but not undoable', () => {
    render(<ActionButtons status="closed" canUndo={false} canForgive={false} {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'Откатить' })).not.toBeInTheDocument()
  })

  it('keeps the secondary row after confirmation when alwaysSecondary is set', () => {
    render(<ActionButtons status="closed" canUndo canForgive alwaysSecondary {...handlers()} />)
    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Простить' })).toBeInTheDocument()
  })

  it('hides the secondary row in the plain closed state', () => {
    render(<ActionButtons status="closed" canUndo canForgive {...handlers()} />)
    expect(screen.queryByRole('button', { name: 'В долг' })).not.toBeInTheDocument()
  })
})

describe('ActionButtons (compact)', () => {
  it('renders three icon actions and disables forgive without debt', () => {
    const h = handlers()
    render(<ActionButtons compact status="pending" canUndo={false} canForgive={false} {...h} />)

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить уборку' }))
    expect(h.onConfirm).toHaveBeenCalledOnce()

    expect(screen.getByRole('button', { name: 'Простить' })).toBeDisabled()
  })
})
