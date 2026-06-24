// @vitest-environment jsdom
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeTimer } from '@/shared/timer/model/fakes'
import type { ServerTime } from '@/shared/timer/model/server-time'
import { createFakeStorage } from '@/storage/model/test/fakes'
import type { WidgetStorage } from '@/storage/model/widget-storage'
import type { WidgetTier } from '@/widget-host/model/tier'
import type { WidgetRuntimeProps } from '@/widget-host/model/types'

import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const timerHolder = vi.hoisted(() => ({ current: null as ServerTime | null }))

vi.mock('@/shared/timer/model/server-time', () => ({
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
  }
}

beforeEach(() => {
  timerHolder.current = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })
})

afterEach(() => {
  context.reset()
  vi.clearAllMocks()
})

describe('OfeliaPoopDuty tier routing', () => {
  it('tiny — shows only the current person', () => {
    render(<OfeliaPoopDuty {...props('tiny')} />)
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.queryByText('Сегодня убирает')).not.toBeInTheDocument()
  })

  it('compact — shows the label and the icon actions', () => {
    render(<OfeliaPoopDuty {...props('compact')} />)
    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
  })

  it('standard — shows the card title and the confirm button', () => {
    render(<OfeliaPoopDuty {...props('standard')} />)
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('standard — draws its own expand/delete controls wired to runtime callbacks', () => {
    const widgetProps = props('standard')
    render(<OfeliaPoopDuty {...widgetProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(widgetProps.requestFullscreen).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()
  })

  it('fullscreen — has no expand/delete controls of its own', () => {
    render(<OfeliaPoopDuty {...props('fullscreen')} />)
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })

  it('large — shows the week navigation and the empty history/comments', () => {
    render(<OfeliaPoopDuty {...props('large')} />)
    expect(screen.getByText('Неделя')).toBeInTheDocument()
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('fullscreen — exposes the close affordance', () => {
    render(<OfeliaPoopDuty {...props('fullscreen')} />)
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
  })

  it('shows a loading state before the first server-time sync', () => {
    timerHolder.current = createFakeTimer()
    render(<OfeliaPoopDuty {...props('standard')} />)
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })
})
