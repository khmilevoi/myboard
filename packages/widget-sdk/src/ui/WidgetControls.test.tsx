// @vitest-environment jsdom
import { fireEvent, render, renderHook, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { WidgetRuntimeContext, type WidgetRuntimeProps } from 'widget-runtime'

import { useWidgetChrome, WidgetControls } from './WidgetControls'

const labels = () =>
  screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))

describe('WidgetControls', () => {
  it('renders nothing when no callback is provided', () => {
    const { container } = render(<WidgetControls />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders only the expand button when the others are omitted', () => {
    render(<WidgetControls onExpand={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })

  it('calls each callback from its own button', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    const onClose = vi.fn()
    render(<WidgetControls onExpand={onExpand} onDelete={onDelete} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  // The point of one component is that a given button always sits in the same
  // place, whatever order a widget happens to spell its props in.
  it('renders the buttons in a fixed order regardless of prop order', () => {
    render(<WidgetControls onClose={vi.fn()} onDelete={vi.fn()} onExpand={vi.fn()} />)
    expect(labels()).toEqual(['Развернуть', 'Удалить', 'Закрыть'])
  })

  it('defaults to the overlay placement', () => {
    const { container } = render(<WidgetControls onDelete={vi.fn()} />)
    expect(container.firstElementChild).toHaveAttribute('data-placement', 'overlay')
  })

  it('marks the inline placement and appends the caller className', () => {
    const { container } = render(
      <WidgetControls onDelete={vi.fn()} placement="inline" className="header-slot" />,
    )
    const root = container.firstElementChild
    expect(root).toHaveAttribute('data-placement', 'inline')
    expect(root).toHaveClass('header-slot')
  })
})

// useWidgetChrome reads exactly four fields off the runtime context, so a
// partial value is cast rather than standing up a whole host runtime.
const chromeContext = (mode: WidgetRuntimeProps['mode']) =>
  ({
    mode,
    requestFullscreen: vi.fn(),
    requestDelete: vi.fn(),
    requestClose: vi.fn(),
  }) as unknown as WidgetRuntimeProps

const renderChrome = (context: WidgetRuntimeProps) =>
  renderHook(() => useWidgetChrome(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <WidgetRuntimeContext.Provider value={context}>{children}</WidgetRuntimeContext.Provider>
    ),
  })

describe('useWidgetChrome', () => {
  it('offers expand and delete on a board card', () => {
    const context = chromeContext('small')
    const { result } = renderChrome(context)

    expect(result.current.onClose).toBeUndefined()
    result.current.onExpand?.()
    result.current.onDelete?.()

    expect(context.requestFullscreen).toHaveBeenCalledOnce()
    expect(context.requestDelete).toHaveBeenCalledOnce()
  })

  it('offers only close on the fullscreen mount', () => {
    const context = chromeContext('large')
    const { result } = renderChrome(context)

    expect(result.current.onExpand).toBeUndefined()
    expect(result.current.onDelete).toBeUndefined()
    result.current.onClose?.()

    expect(context.requestClose).toHaveBeenCalledOnce()
  })
})
