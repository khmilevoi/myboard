import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useWidgetContext } from 'widget-runtime'

import { addInstance, expandedInstanceId } from '@/board/model/board-model'
import { activeBoardId, LOCAL_BOARD_ID, localBoard } from '@/board/model/board-storage'
import { findWidgetType } from '@/widget-registry/model/registry'

import { FullscreenOverlay } from './FullscreenOverlay'

const registryHolder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

const federation = vi.hoisted(() => ({
  loadRemote: vi.fn(),
}))

// The generated catalog loads first-party widgets over Module Federation; no
// host instance exists under Vitest, so loadRemote must be mocked (same recipe
// as WidgetFrame.test.tsx).
vi.mock('@module-federation/runtime', () => ({
  loadRemote: federation.loadRemote,
}))

const StubClockWidget = () => <div>12:34</div>

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  registryHolder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

beforeEach(() => {
  context.reset()
  localStorage.clear()
  // context.reset() restores localBoard to its initial empty snapshot; setting
  // it again here would schedule a storage write whose publish lands MID-test,
  // remounting the overlay content and detaching queried nodes.
  activeBoardId.set(LOCAL_BOARD_ID)
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
  federation.loadRemote.mockResolvedValue({
    default: {
      loadComponent: async () => ({ default: StubClockWidget }),
    },
  })
})

describe('FullscreenOverlay', () => {
  it('renders nothing when no instance is expanded', () => {
    const { container } = render(<FullscreenOverlay />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a large frame for the expanded instance', async () => {
    addInstance('clock')
    const id = localBoard().instances[0]?.id
    if (!id) throw new Error('expected instance id after addInstance')
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText(/:/)).toBeInTheDocument()
  })

  it('closes when the widget itself calls requestClose (the dialog draws no close button of its own)', async () => {
    const Probe = () => <button onClick={useWidgetContext().requestClose}>widget close</button>
    vi.mocked(findWidgetType).mockImplementation((typeId) => {
      if (typeId === 'probe') {
        return {
          id: 'probe',
          title: 'Probe',
          description: 'probe widget',
          loadComponent: async () => ({ default: Probe }),
          defaultSize: { w: 3, h: 5 },
          icon: 'Clock',
        }
      }

      return registryHolder.actual(typeId)
    })

    addInstance('probe')
    const id = localBoard().instances[0]?.id
    if (!id) throw new Error('expected instance id after addInstance')
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    fireEvent.click(await screen.findByRole('button', { name: 'widget close' }))
    expect(expandedInstanceId()).toBeNull()
  })

  it('closes on Escape', async () => {
    addInstance('clock')
    const id = localBoard().instances[0]?.id
    if (!id) throw new Error('expected instance id after addInstance')
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(expandedInstanceId()).toBeNull()
  })

  it('renders the expanded widget with the fullscreen tier', async () => {
    const Probe = () => <div>tier:{useWidgetContext().tier}</div>
    vi.mocked(findWidgetType).mockImplementation((typeId) => {
      if (typeId === 'probe') {
        return {
          id: 'probe',
          title: 'Probe',
          description: 'probe widget',
          loadComponent: async () => ({ default: Probe }),
          defaultSize: { w: 3, h: 5 },
          icon: 'Clock',
        }
      }

      return registryHolder.actual(typeId)
    })

    addInstance('probe')
    const id = localBoard().instances[0]?.id
    if (!id) throw new Error('expected instance id after addInstance')
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)

    expect(await screen.findByText('tier:fullscreen')).toBeInTheDocument()
  })
})
