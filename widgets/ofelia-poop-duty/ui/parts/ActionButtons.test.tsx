// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActionButtons } from './ActionButtons'

const handlers = () => ({
  onConfirm: vi.fn(),
  onUndo: vi.fn(),
  onDebt: vi.fn(),
  onForgive: vi.fn(),
})

describe('ActionButtons (compact)', () => {
  it('routes to IconButtons', () => {
    render(
      <ActionButtons compact status="pending" canUndo={false} canForgive={false} {...handlers()} />,
    )
    expect(screen.getByLabelText('Подтвердить уборку')).toHaveAttribute('data-tone', 'confirm')
  })

  it('passes inactive to IconButtons', () => {
    render(
      <ActionButtons
        compact
        status="pending"
        canUndo={false}
        canForgive
        inactive
        {...handlers()}
      />,
    )
    expect(screen.getByLabelText('Подтвердить уборку')).toBeDisabled()
  })
})

describe('ActionButtons (full)', () => {
  it('routes to LabeledButtons with default primaryLabel', () => {
    render(<ActionButtons status="pending" canUndo={false} canForgive {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('passes primaryLabel to LabeledButtons', () => {
    render(
      <ActionButtons
        status="pending"
        canUndo={false}
        canForgive
        primaryLabel="Подтвердить уборку"
        {...handlers()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
  })

  it('passes inactive to LabeledButtons', () => {
    render(<ActionButtons status="pending" canUndo={false} canForgive inactive {...handlers()} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
  })
})
