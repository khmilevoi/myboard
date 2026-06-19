// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Clock } from './Clock'
import type { WidgetRuntimeProps } from '../../../src/widget-host/model/types'
import { createWidgetStorage } from '../../../src/storage/model/widget-storage'

function props(mode: WidgetRuntimeProps['mode']): WidgetRuntimeProps {
  return {
    instanceId: 'inst-clock',
    typeId: 'clock',
    mode,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    reportError: vi.fn(),
    storage: createWidgetStorage({
      instanceId: 'inst-clock',
      typeId: 'clock',
    }),
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
})
