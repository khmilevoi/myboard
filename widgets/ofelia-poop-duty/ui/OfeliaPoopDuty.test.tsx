// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeTimer } from '@widget-runtime/timer/fakes'
import type { ServerTime } from '@widget-runtime/timer/server-time'
import type { WidgetStorage } from '@widget-runtime/storage'
import { createFakeStorage } from '@widget-runtime/storage/test/fakes'
import type { WidgetTier } from '@/widget-host/model/tier'
import type { WidgetRuntimeProps } from '@/widget-host/model/types'

import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const timerHolder = vi.hoisted(() => ({ current: null as ServerTime | null }))

vi.mock('@widget-runtime/timer/server-time', () => ({
  getServerTime: () => timerHolder.current,
}))

function fakeWidgetStorage(): WidgetStorage {
  const instanceClient = createFakeStorage()
  const instanceServer = createFakeStorage()
  const sharedClient = createFakeStorage()
  const sharedServer = createFakeStorage()

  return {
    instance: { client: instanceClient, server: instanceServer },
    shared: { client: sharedClient, server: sharedServer },
  }
}

function props(tier: WidgetTier): WidgetRuntimeProps {
  return {
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
    mode: 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: fakeWidgetStorage(),
    api: { invoke: vi.fn() },
  }
}

beforeEach(() => {
  timerHolder.current = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })
})

afterEach(() => {
  cleanup()
  context.reset()
  vi.clearAllMocks()
})

async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.queryByLabelText('Загрузка виджета Офелии')).not.toBeInTheDocument()
  })
}

describe('OfeliaPoopDuty tier routing', () => {
  it('tiny — shows only the current person', async () => {
    render(<OfeliaPoopDuty {...props('tiny')} />)
    await waitForLoaded()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.queryByText('Сегодня убирает')).not.toBeInTheDocument()
  })

  it('compact — shows the label and the icon actions', async () => {
    render(<OfeliaPoopDuty {...props('compact')} />)
    await waitForLoaded()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('standard — shows the card title and the confirm button', async () => {
    render(<OfeliaPoopDuty {...props('standard')} />)
    await waitForLoaded()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('standard — draws its own expand/delete controls wired to runtime callbacks', async () => {
    const widgetProps = props('standard')
    render(<OfeliaPoopDuty {...widgetProps} />)
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(widgetProps.requestFullscreen).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()
  })

  it('fullscreen — has no expand/delete controls of its own', async () => {
    render(<OfeliaPoopDuty {...props('fullscreen')} />)
    await waitForLoaded()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })

  it('large — shows the week navigation and the empty history/comments', async () => {
    render(<OfeliaPoopDuty {...props('large')} />)
    await waitForLoaded()
    expect(screen.getByText('Неделя')).toBeInTheDocument()
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('fullscreen — exposes the close affordance', async () => {
    render(<OfeliaPoopDuty {...props('fullscreen')} />)
    await waitForLoaded()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
  })

  it('shows a loading state before the first server-time sync', () => {
    timerHolder.current = createFakeTimer()
    render(<OfeliaPoopDuty {...props('standard')} />)
    expect(screen.getByLabelText('Загрузка виджета Офелии')).toHaveAttribute(
      'data-slot',
      'skeleton',
    )
  })
})
