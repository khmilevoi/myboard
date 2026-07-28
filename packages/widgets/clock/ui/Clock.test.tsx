// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  makeHostRuntime,
  makeStaticWidgetIdentity,
  type WidgetRuntimeProps,
  WidgetRuntimeContext,
} from 'widget-runtime'

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
    storage: makeHostRuntime().makeWidgetStorage({
      instanceId: 'inst-clock',
      typeId: 'clock',
    }),
    api: { invoke: vi.fn() },
    identity: makeStaticWidgetIdentity(),
  }
}

function renderClock(widgetProps: WidgetRuntimeProps) {
  return render(
    <WidgetRuntimeContext.Provider value={widgetProps}>
      <Clock />
    </WidgetRuntimeContext.Provider>,
  )
}

describe('Clock', () => {
  it('renders the small clock view', () => {
    renderClock(props('small'))
    expect(screen.getByText(/:/)).toBeInTheDocument()
  })

  it('renders the large clock view', () => {
    renderClock(props('large'))
    expect(screen.getByText(/:/)).toBeInTheDocument()
    expect(screen.getByText(/\d{4}/)).toBeInTheDocument()
  })

  it('draws its own expand/delete controls wired to runtime callbacks', () => {
    const widgetProps = props('small')
    renderClock(widgetProps)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(widgetProps.requestFullscreen).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()
  })

  it('offers a close control, and no expand or delete, in the fullscreen (large) view', () => {
    const widgetProps = props('large')
    renderClock(widgetProps)

    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(widgetProps.requestClose).toHaveBeenCalledOnce()
  })
})
