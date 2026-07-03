import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type WidgetComponent, useWidgetContext } from 'widget-runtime'

import { findWidgetType } from '@/widget-registry/model/registry'

import { addInstance } from '../model/board-model'
import { activeBoard, activeBoardId, LOCAL_BOARD_ID, localBoard } from '../model/board-storage'
import { Board } from './Board'

const registryHolder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

const federation = vi.hoisted(() => ({
  loadRemote: vi.fn(),
}))

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
})

describe('Board', () => {
  it('shows the empty state when there are no widgets', () => {
    render(<Board />)
    expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
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
})
