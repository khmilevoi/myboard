import { context } from '@reatom/core'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type WidgetComponent, useWidgetContext } from 'widget-runtime'

import { findWidgetType } from '@/widget-registry/model/registry'

import { addInstance, resetMobileLayout } from '../model/board-model'
import { activeBoard, activeBoardId, LOCAL_BOARD_ID, localBoard } from '../model/board-storage'
import { deriveMobileLayout } from '../model/mobile-layout'
import { Board } from './Board'

const registryHolder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

const federation = vi.hoisted(() => ({
  loadRemote: vi.fn(),
}))

const grid = vi.hoisted(() => ({
  width: 1920,
  props: null as null | Record<string, any>,
}))

// The real grid still renders — every existing test depends on it. The wrapper
// only records the props Board passed, and useContainerWidth is overridden
// because jsdom reports 0 for every measured element, which would send the
// component down the `width || 1200` desktop fallback in every test.
vi.mock('react-grid-layout', async (importActual) => {
  const actual = await importActual<typeof import('react-grid-layout')>()
  const Recorder = (props: Record<string, any>) => {
    grid.props = props
    return createElement<any>(actual.default, props)
  }

  return {
    ...actual,
    default: Recorder,
    useContainerWidth: () => ({
      width: grid.width,
      mounted: true,
      containerRef: { current: null },
      measureWidth: () => {},
    }),
  }
})

// The generated catalog loads first-party widgets over Module Federation;
// no host instance exists under Vitest, so loadRemote must be mocked (same
// recipe as WidgetFrame.test.tsx). The stub mirrors the piece the tests
// exercise: the widget's own delete control wired to requestDelete.
vi.mock('@module-federation/runtime', () => ({
  loadRemote: federation.loadRemote,
}))

const StubClockWidget = () => (
  <button aria-label="Удалить" onClick={useWidgetContext().requestDelete}>
    Удалить
  </button>
)

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  registryHolder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

const BrokenWidget = (() => {
  throw new Error('boom')
}) as WidgetComponent

beforeEach(() => {
  context.reset()
  localStorage.clear()
  // context.reset() restores localBoard to its initial empty snapshot; setting
  // it again here would schedule a storage write whose publish lands MID-test,
  // flipping Board through EmptyState and detaching every queried card node.
  activeBoardId.set(LOCAL_BOARD_ID)
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
  federation.loadRemote.mockResolvedValue({
    default: {
      loadComponent: async () => ({ default: StubClockWidget }),
    },
  })
  grid.width = 1920
  grid.props = null
})

describe('Board', () => {
  it('shows the empty state when there are no widgets', () => {
    render(<Board />)
    expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
  })

  it('keeps the measured grid container mounted even with no widgets', async () => {
    // Regression guard. useContainerWidth attaches its ResizeObserver from a
    // single mount effect that bails out while the ref is still null and never
    // re-runs. `activeBoard()` is null on the first render, so rendering the
    // measured element only once instances exist left the observer unattached
    // forever, pinning the grid width to the hook's 1280 default and making the
    // mobile breakpoint unreachable in a real browser.
    const empty = render(<Board />)
    expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
    expect(screen.getByTestId('board-grid-container')).toBeInTheDocument()
    empty.unmount()

    addInstance('clock')
    render(<Board />)
    await screen.findByTestId('widget-card')
    expect(screen.getByTestId('board-grid-container')).toBeInTheDocument()
  })

  it('renders a card for each instance', () => {
    addInstance('clock')
    render(<Board />)
    expect(screen.getByTestId('widget-card')).toBeInTheDocument()
  })

  it('removes a widget via its remove button', async () => {
    addInstance('clock')
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    // The delete control now lives inside the lazily-loaded widget itself, so
    // it only appears once the widget's chunk has resolved.
    const deleteButton = await within(card).findByRole('button', { name: 'Удалить' })
    fireEvent.click(deleteButton)
    expect(activeBoard()?.instances).toHaveLength(0)
  })

  it('removes an unknown widget via the error-card delete action', async () => {
    localBoard.set({
      id: LOCAL_BOARD_ID,
      name: LOCAL_BOARD_ID,
      instances: [{ id: 'missing-1', typeId: 'missing' }],
      layout: [{ i: 'missing-1', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }],
    })

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(within(card).getByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButton = within(card).getByRole('button', { name: 'Удалить' })

    fireEvent.click(deleteButton)

    expect(activeBoard()?.instances).toHaveLength(0)
    expect(activeBoard()?.layout).toHaveLength(0)
  })

  it('removes a crashed widget via the error-boundary delete action', async () => {
    vi.mocked(findWidgetType).mockImplementation((typeId) => {
      if (typeId === 'boom') {
        return {
          id: 'boom',
          title: 'Сломанный виджет',
          description: 'Падает во время render',
          loadComponent: async () => ({ default: BrokenWidget }),
          defaultSize: { w: 3, h: 2 },
          icon: 'Clock',
        }
      }

      return registryHolder.actual(typeId)
    })

    addInstance('boom')

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(await within(card).findByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButton = within(card).getByRole('button', { name: 'Удалить' })

    fireEvent.click(deleteButton)

    expect(activeBoard()?.instances).toHaveLength(0)
    expect(activeBoard()?.layout).toHaveLength(0)
  })

  it('makes the whole card draggable instead of a dedicated handle element', async () => {
    addInstance('clock')
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    const handle = card.querySelector('.widget-drag-handle')
    expect(handle).not.toBeNull()
    expect(handle).toBe(card.firstElementChild)
    expect(card.querySelector('iframe')).toBeNull()
  })

  it('does not derive tier from grid layout size — WidgetFrame measures its own rendered size', async () => {
    // Grid columns resize with the viewport, so a fixed w/h in grid units maps to a
    // different pixel size on every screen. Board must leave tier resolution to
    // WidgetFrame's own size measurement instead of computing it from layout units.
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

    localBoard.set({
      id: LOCAL_BOARD_ID,
      name: LOCAL_BOARD_ID,
      instances: [{ id: 'big', typeId: 'probe' }],
      layout: [{ i: 'big', x: 0, y: 0, w: 6, h: 8, minW: 2, minH: 2 }],
    })

    render(<Board />)

    expect(await screen.findByText('tier:tiny')).toBeInTheDocument()
  })

  it('renders a single column with the derived layout at mobile width', async () => {
    grid.width = 390
    addInstance('clock')
    addInstance('clock')

    render(<Board />)
    await screen.findAllByTestId('widget-card')

    expect(grid.props?.['gridConfig']).toEqual({ cols: 1, rowHeight: 40, margin: [10, 10] })
    expect(grid.props?.['layout']).toEqual(deriveMobileLayout(activeBoard()!.layout))
    expect(grid.props?.['dragConfig']?.handle).toBe('.widget-drag-grip')
  })

  it('keeps the twelve-column zoomed grid at desktop width', async () => {
    grid.width = 3840
    addInstance('clock')

    render(<Board />)
    await screen.findByTestId('widget-card')

    expect(grid.props?.['gridConfig']).toEqual({ cols: 12, rowHeight: 60, margin: [20, 20] })
    expect(grid.props?.['layout']).toEqual(activeBoard()!.layout)
    expect(grid.props?.['dragConfig']?.handle).toBe('.widget-drag-handle')
  })

  it('does not create a mobile layout just by mounting at mobile width', async () => {
    // The critical guard: onLayoutChange fires on mount after compaction, so a
    // naive implementation would freeze the mobile layout with no interaction at
    // all and permanently degrade derive-and-override into always-frozen.
    grid.width = 390
    addInstance('clock')

    render(<Board />)
    await screen.findByTestId('widget-card')

    expect(activeBoard()?.mobileLayout).toBeUndefined()
  })

  it('materializes and then persists the mobile layout once a drag starts', async () => {
    grid.width = 390
    addInstance('clock')

    render(<Board />)
    await screen.findByTestId('widget-card')

    const derived = deriveMobileLayout(activeBoard()!.layout)
    act(() => {
      grid.props?.['onDragStart']?.([], null, null, null, new Event('mousedown'), null)
    })
    expect(activeBoard()?.mobileLayout).toEqual(derived)

    const dragged = derived.map((item) => ({ ...item, h: item.h + 3 }))
    act(() => {
      grid.props?.['onLayoutChange']?.(dragged)
    })
    expect(activeBoard()?.mobileLayout).toEqual(dragged)
    expect(activeBoard()?.layout).not.toEqual(dragged)

    act(() => {
      resetMobileLayout()
    })
    expect(activeBoard()?.mobileLayout).toBeUndefined()
  })

  it('renders a drag grip inside every card', async () => {
    grid.width = 390
    addInstance('clock')

    render(<Board />)
    const card = await screen.findByTestId('widget-card')

    expect(card.querySelector('.widget-drag-grip')).not.toBeNull()
  })
})
