// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { WidgetErrorBoundary } from './WidgetErrorBoundary'

function Broken() {
  throw new Error('boom')
}

describe('WidgetErrorBoundary', () => {
  it('renders fallback and calls onError', () => {
    const onError = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={vi.fn()} onError={onError}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    expect(screen.getByText(/widget failed to load/i)).toBeInTheDocument()
    expect(onError).toHaveBeenCalled()
  })

  it('calls retry from the fallback', () => {
    const onRetry = vi.fn()
    render(
      <WidgetErrorBoundary resetKey={0} onRetry={onRetry} onError={vi.fn()}>
        <Broken />
      </WidgetErrorBoundary>,
    )

    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('clears the error when resetKey changes', () => {
    const onRetry = vi.fn()
    const onError = vi.fn()
    const Good = () => <div>all good</div>

    const { rerender } = render(
      <WidgetErrorBoundary resetKey={0} onRetry={onRetry} onError={onError}>
        <Broken />
      </WidgetErrorBoundary>,
    )
    expect(screen.getByText(/widget failed to load/i)).toBeInTheDocument()

    rerender(
      <WidgetErrorBoundary resetKey={1} onRetry={onRetry} onError={onError}>
        <Good />
      </WidgetErrorBoundary>,
    )
    expect(screen.getByText(/all good/i)).toBeInTheDocument()
  })
})
