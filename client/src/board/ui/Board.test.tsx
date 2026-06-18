// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { WidgetComponent } from '../../widget-host/model/types'
import { findWidgetType } from '../../widget-registry/model/registry'
import { addInstance, instances, layout } from '../model/board-model'
import { Board } from './Board'

const registryHolder = vi.hoisted(() => ({
  actual: null as unknown as typeof import('../../widget-registry/model/registry')['findWidgetType'],
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
    expect(screen.getByText(/no widgets yet/i)).toBeInTheDocument()
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
    fireEvent.click(within(card).getByRole('button', { name: 'Удалить' }))
    expect(instances()).toHaveLength(0)
  })

  it('removes an unknown widget via the error-card delete action', async () => {
    instances.set([{ id: 'missing-1', typeId: 'missing' }])
    layout.set([{ i: 'missing-1', x: 0, y: 0, w: 3, h: 2, minW: 2, minH: 2 }])

    render(<Board />)

    const card = await screen.findByTestId('widget-card')
    expect(within(card).getByText('Виджет не отвечает')).toBeInTheDocument()
    const deleteButtons = within(card).getAllByRole('button', { name: 'Удалить' })
    expect(deleteButtons).toHaveLength(2)
    const errorDeleteButton = deleteButtons[1]
    if (!errorDeleteButton) throw new Error('error delete button not found')

    fireEvent.click(errorDeleteButton)

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
    const deleteButtons = within(card).getAllByRole('button', { name: 'Удалить' })
    const errorDeleteButton = deleteButtons.at(-1)
    if (!errorDeleteButton) throw new Error('error-boundary delete button not found')

    fireEvent.click(errorDeleteButton)

    expect(instances()).toHaveLength(0)
    expect(layout()).toHaveLength(0)
  })

  it('renders a stable drag handle for grid interactions', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    const handle = within(card).getByText('Часы')
    expect(handle).toHaveClass('widget-drag-handle')
    expect(card.querySelector('iframe')).toBeNull()
  })
})
