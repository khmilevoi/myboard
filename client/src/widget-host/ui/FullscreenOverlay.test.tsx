// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { addInstance, expandedInstanceId } from '../../board/model/board-model'
import { findWidgetType } from '../../widget-registry/model/registry'
import type { WidgetRuntimeProps } from '../model/types'
import { FullscreenOverlay } from './FullscreenOverlay'

const registryHolder = vi.hoisted(() => ({
  actual: null as unknown as typeof import('../../widget-registry/model/registry')['findWidgetType'],
}))

vi.mock('../../widget-registry/model/registry', async (importActual) => {
  const actual = await importActual<typeof import('../../widget-registry/model/registry')>()
  registryHolder.actual = actual.findWidgetType
  return { ...actual, findWidgetType: vi.fn(actual.findWidgetType) }
})

beforeEach(() => {
  context.reset()
  localStorage.clear()
  vi.mocked(findWidgetType).mockImplementation(registryHolder.actual)
})

describe('FullscreenOverlay', () => {
  it('renders nothing when no instance is expanded', () => {
    const { container } = render(<FullscreenOverlay />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a large frame for the expanded instance and closes via the close button', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText(/:/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(expandedInstanceId()).toBeNull()
  })

  it('closes on Escape', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(expandedInstanceId()).toBeNull()
  })

  it('renders the expanded widget with the fullscreen tier', async () => {
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

    const id = addInstance('probe')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)

    expect(await screen.findByText('tier:fullscreen')).toBeInTheDocument()
  })
})
