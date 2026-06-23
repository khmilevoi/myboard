// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IconButtons } from './IconButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('IconButtons', () => {
  it('renders three icon buttons with correct tones', () => {
    render(<IconButtons canForgive {...handlers()} />)
    expect(screen.getByLabelText('Подтвердить уборку')).toHaveAttribute('data-tone', 'confirm')
    expect(screen.getByLabelText('В долг')).toHaveAttribute('data-tone', 'debt')
    expect(screen.getByLabelText('Простить')).toHaveAttribute('data-tone', 'forgive')
  })

  it('fires handlers on click', () => {
    const h = handlers()
    render(<IconButtons canForgive {...h} />)
    fireEvent.click(screen.getByLabelText('Подтвердить уборку'))
    fireEvent.click(screen.getByLabelText('В долг'))
    fireEvent.click(screen.getByLabelText('Простить'))
    expect(h.onConfirm).toHaveBeenCalledOnce()
    expect(h.onDebt).toHaveBeenCalledOnce()
    expect(h.onForgive).toHaveBeenCalledOnce()
  })

  it('disables forgive when canForgive is false', () => {
    render(<IconButtons canForgive={false} {...handlers()} />)
    expect(screen.getByLabelText('Простить')).toBeDisabled()
  })
})
