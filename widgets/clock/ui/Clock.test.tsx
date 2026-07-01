// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { makeWidgetStorage, type WidgetRuntimeProps } from 'widget-runtime'

import { Clock } from './Clock'

function props(mode: WidgetRuntimeProps['mode']): WidgetRuntimeProps {
  return {
    instanceId: 'inst-clock',
    typeId: 'clock',
    mode,
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeWidgetStorage({
      instanceId: 'inst-clock',
      typeId: 'clock',
    }),
    api: { invoke: vi.fn() },
  }
}

describe('Clock', () => {
  it('renders the small clock view', () => {
    render(<Clock {...props('small')} />)
    expect(screen.getByText(/:/)).toBeInTheDocument()
  })

  it('renders the large clock view', () => {
    render(<Clock {...props('large')} />)
    expect(screen.getByText(/:/)).toBeInTheDocument()
    expect(screen.getByText(/\d{4}/)).toBeInTheDocument()
  })

  it('draws its own expand/delete controls wired to runtime callbacks', () => {
    const widgetProps = props('small')
    render(<Clock {...widgetProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(widgetProps.requestFullscreen).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()
  })

  it('has no expand/delete controls in the fullscreen (large) view', () => {
    render(<Clock {...props('large')} />)
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })
})
