import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WidgetComponent, WidgetRuntimeProps } from '@/widget-host/model/types'
import { findWidgetType } from '@/widget-registry/model/registry'

import { addInstance, instances, layout } from '../model/board-model'
import { Board } from './Board'

const registryHolder = vi.hoisted(() => ({
  actual:
    null as unknown as (typeof import('../../widget-registry/model/registry'))['findWidgetType'],
}))

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
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
})

describe('Board', () => {
  it('shows the empty state when there are no widgets', () => {
    render(<Board />)
    expect(screen.getByText('Начните с первого виджета')).toBeInTheDocument()
  })

  it('renders a card for each instance', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    expect(screen.getByTestId('widget-card')).toBeInTheDocument()
  })

  it('removes a widget via its remove button', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    // The delete control now lives inside the lazily-loaded widget itself, so
    // it only appears once the widget's chunk has resolved.
    const deleteButton = await within(card).findByRole('button', { name: 'Удалить' })
    fireEvent.click(deleteButton)
    expect(instances()).toHaveLength(0)
  })

  it('removes an unknown widget via the error-card delete action', async () => {
    instances.set([{ id: 'missing-1', typeId: 'missing' }])
    layout.set([{ i: 'missing-1', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }])

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(within(card).getByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButton = within(card).getByRole('button', { name: 'Удалить' })

    fireEvent.click(deleteButton)

    expect(instances()).toHaveLength(0)
    expect(layout()).toHaveLength(0)
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

    const id = addInstance('boom')
    if (id instanceof Error) throw id

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(await within(card).findByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButton = within(card).getByRole('button', { name: 'Удалить' })

    fireEvent.click(deleteButton)

    expect(instances()).toHaveLength(0)
    expect(layout()).toHaveLength(0)
  })

  it('makes the whole card draggable instead of a dedicated handle element', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
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
    const Probe = (props: WidgetRuntimeProps) => <div>tier:{props.tier}</div>
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

    instances.set([{ id: 'big', typeId: 'probe' }])
    layout.set([{ i: 'big', x: 0, y: 0, w: 6, h: 8, minW: 2, minH: 2 }])

    render(<Board />)

    expect(await screen.findByText('tier:tiny')).toBeInTheDocument()
  })
})
