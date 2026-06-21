import { fireEvent, render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { findWidgetType, UnknownWidgetTypeError } from '@/widget-registry/model/registry'

import type { WidgetRuntimeProps } from '../model/types'
import { WidgetFrame } from './WidgetFrame'

const holder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
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
  it('shows the restyled error card for an unknown widget type', () => {
    vi.mocked(findWidgetType).mockReturnValue(new UnknownWidgetTypeError({ typeId: 'missing' }))
    render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" tier="standard" />)
    expect(screen.getByText('Виджет не отвечает')).toBeInTheDocument()
  })

  it('calls onDelete from the unknown-type card', () => {
    vi.mocked(findWidgetType).mockReturnValue(new UnknownWidgetTypeError({ typeId: 'missing' }))
    const onDelete = vi.fn()
    render(
      <WidgetFrame
        instanceId="inst-2"
        typeId="missing"
        mode="small"
        tier="standard"
        onDelete={onDelete}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('renders the loadable widget component content', async () => {
    const { container } = render(
      <WidgetFrame instanceId="inst-1" typeId="clock" mode="small" tier="standard" />,
    )
    expect(await screen.findByText(/:/)).toBeInTheDocument()
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('shows the loading skeleton while the component is loading', () => {
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'clock',
      title: 'Часы',
      description: 'Текущее время и дата',
      loadComponent: () => new Promise<never>(() => {}),
      defaultSize: { w: 3, h: 2 },
      icon: 'Clock',
    })
    const { container } = render(
      <WidgetFrame instanceId="inst-skel" typeId="clock" mode="small" tier="standard" />,
    )
    expect(container.querySelector('iframe')).toBeNull()
    expect(container.querySelector('[data-slot="skeleton"]')).not.toBeNull()
  })

  it('passes the resolved tier to the widget component', async () => {
    const Probe = (props: WidgetRuntimeProps) => <div>tier:{props.tier}</div>
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'probe',
      title: 'Probe',
      description: 'probe widget',
      loadComponent: async () => ({ default: Probe }),
      defaultSize: { w: 3, h: 5 },
      icon: 'Clock',
    })

    render(<WidgetFrame instanceId="probe-1" typeId="probe" mode="large" tier="fullscreen" />)

    expect(await screen.findByText('tier:fullscreen')).toBeInTheDocument()
  })
})
