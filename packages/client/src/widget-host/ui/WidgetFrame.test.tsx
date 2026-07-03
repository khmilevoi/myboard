import { fireEvent, render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWidgetContext } from 'widget-runtime'

import { findWidgetType, UnknownWidgetTypeError } from '@/widget-registry/model/registry'

import { WidgetFrame } from './WidgetFrame'

const holder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
  measuredSize: { width: 0, height: 0 },
}))

const federation = vi.hoisted(() => ({
  loadRemote: vi.fn(),
}))

vi.mock('@module-federation/runtime', () => ({
  loadRemote: federation.loadRemote,
}))

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  holder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

vi.mock('@/shared/element-size/model/use-element-size', () => ({
  useElementSize: () => ({ ...holder.measuredSize, ref: () => {} }),
}))

beforeEach(() => {
  vi.mocked(findWidgetType).mockImplementation(holder.actual)
  holder.measuredSize = { width: 0, height: 0 }
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
    const RemoteClock = () => <div>12:34</div>
    federation.loadRemote.mockResolvedValue({
      default: {
        loadComponent: async () => ({ default: RemoteClock }),
      },
    })

    const { container } = render(
      <WidgetFrame instanceId="inst-1" typeId="clock" mode="small" tier="standard" />,
    )
    expect(await screen.findByText(/:/)).toBeInTheDocument()
    expect(federation.loadRemote).toHaveBeenCalledWith('clock/client')
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

  it('provides the resolved tier to the widget component through runtime context', async () => {
    const Probe = () => <div>tier:{useWidgetContext().tier}</div>
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

  it('resolves the tier from its measured size when no tier override is given', async () => {
    const Probe = () => <div>tier:{useWidgetContext().tier}</div>
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'probe',
      title: 'Probe',
      description: 'probe widget',
      loadComponent: async () => ({ default: Probe }),
      defaultSize: { w: 3, h: 5 },
      icon: 'Clock',
    })
    holder.measuredSize = { width: 320, height: 280 }

    render(<WidgetFrame instanceId="probe-2" typeId="probe" mode="small" />)

    expect(await screen.findByText('tier:standard')).toBeInTheDocument()
  })

  it('falls back to tiny when the measured size clears no threshold', async () => {
    const Probe = () => <div>tier:{useWidgetContext().tier}</div>
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'probe',
      title: 'Probe',
      description: 'probe widget',
      loadComponent: async () => ({ default: Probe }),
      defaultSize: { w: 3, h: 5 },
      icon: 'Clock',
    })
    holder.measuredSize = { width: 10, height: 10 }

    render(<WidgetFrame instanceId="probe-3" typeId="probe" mode="small" />)

    expect(await screen.findByText('tier:tiny')).toBeInTheDocument()
  })

  it('provides one type- and instance-bound API through runtime context', async () => {
    const fetchRequest = vi.fn(
      async () => new Response(JSON.stringify({ data: { ok: true } }), { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchRequest)

    const Probe = () => {
      const context = useWidgetContext()
      return <button onClick={() => context.api.invoke('probe', { value: 1 })}>context-api</button>
    }
    vi.mocked(findWidgetType).mockReturnValue({
      id: 'probe/type',
      title: 'Probe',
      description: 'probe widget',
      loadComponent: async () => ({ default: Probe }),
      defaultSize: { w: 1, h: 1 },
      icon: 'Clock',
    })

    render(<WidgetFrame instanceId="instance-7" typeId="probe/type" mode="small" />)
    fireEvent.click(await screen.findByRole('button', { name: 'context-api' }))

    await vi.waitFor(() => {
      expect(fetchRequest).toHaveBeenCalledWith(
        '/api/widgets/probe%2Ftype/probe',
        expect.objectContaining({
          body: JSON.stringify({ instanceId: 'instance-7', payload: { value: 1 } }),
        }),
      )
    })
    vi.unstubAllGlobals()
  })
})
