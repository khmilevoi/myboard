// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { findWidgetType, UnknownWidgetTypeError } from '../../widget-registry/model/registry'
import { WidgetFrame } from './WidgetFrame'

const holder = vi.hoisted(() => ({
  actual: null as unknown as typeof import('../../widget-registry/model/registry')['findWidgetType'],
}))

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  holder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

beforeEach(() => {
  vi.mocked(findWidgetType).mockImplementation(holder.actual)
})

describe('WidgetFrame', () => {
  it('shows an error card for an unknown widget type', () => {
    vi.mocked(findWidgetType).mockReturnValue(new UnknownWidgetTypeError({ typeId: 'missing' }))
    render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" />)
    expect(screen.getByText(/widget unavailable/i)).toBeInTheDocument()
  })

  it('renders the loadable widget component content', async () => {
    const { container } = render(<WidgetFrame instanceId="inst-1" typeId="clock" mode="small" />)
    expect(await screen.findByText(/:/)).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('shows the loading skeleton while the component is loading', () => {
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'clock',
      title: 'Clock',
      loadComponent: () => new Promise<never>(() => {}),
      defaultSize: { w: 3, h: 2 },
      icon: 'Clock',
    })
    const { container } = render(<WidgetFrame instanceId="inst-skel" typeId="clock" mode="small" />)
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[class*="skeleton"]')).not.toBeNull()
  })
})
