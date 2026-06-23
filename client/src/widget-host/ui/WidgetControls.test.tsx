// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WidgetControls } from './WidgetControls'

describe('WidgetControls', () => {
  it('renders nothing when no callback is provided', () => {
    const { container } = render(<WidgetControls />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the expand button when onDelete is omitted', () => {
    render(<WidgetControls onExpand={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })

  it('calls onExpand and onDelete from their respective buttons', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    render(<WidgetControls onExpand={onExpand} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
