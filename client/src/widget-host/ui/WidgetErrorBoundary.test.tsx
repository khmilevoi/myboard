// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WidgetErrorBoundary } from './WidgetErrorBoundary'

function Broken(): never {
  throw new Error('boom')
}

describe('WidgetErrorBoundary', () => {
  it('renders the restyled fallback and calls onError', () => {
    const onError = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={onError}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    expect(screen.getByText('Виджет не отвечает')).toBeInTheDocument()
    expect(onError).toHaveBeenCalled()
  })

  it('calls retry from the fallback', () => {
    const onRetry = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={onRetry} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('calls onDelete when delete is clicked', () => {
    const onDelete = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={vi.fn()} onDelete={onDelete}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('omits the delete button when onDelete is not provided', () => {
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })

  it('clears the error when resetKey changes', () => {
    const Good = () => <div>all good</div>
    const { rerender } = render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )
    expect(screen.getByText('Виджет не отвечает')).toBeInTheDocument()

    rerender(
      <WidgetErrorBoundary resetKey={1} onRetry={vi.fn()} onError={vi.fn()}>
        <Good />
      </WidgetErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })
})
