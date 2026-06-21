// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { WidgetRuntimeProps } from '../../../src/widget-host/model/types'
import { createWidgetStorage } from '../../../src/storage/model/widget-storage'
import { createFakeTimer } from '../../../src/shared/timer/model/fakes'
import type { ServerTime } from '../../../src/shared/timer/model/server-time'
import { OfeliaPoopDuty } from './OfeliaPoopDuty'

// vi.hoisted lifts the holder above the (also-hoisted) vi.mock factory. The
// factory reads `timerHolder.current` lazily at getServerTime() call time, so
// each test can swap the fake in beforeEach (createFakeTimer is a normal
// import, available by the time beforeEach runs).
const timerHolder = vi.hoisted(() => ({ current: null as ServerTime | null }))

vi.mock('../../../src/shared/timer/model/server-time', () => ({
  getServerTime: () => timerHolder.current,
}))

function props(mode: WidgetRuntimeProps['mode']): WidgetRuntimeProps {
  return {
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
    mode,
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    reportError: vi.fn(),
    storage: createWidgetStorage({
      instanceId: 'ofelia-poop-duty-1',
      typeId: 'ofelia-poop-duty',
    }),
  }
}

beforeEach(() => {
  timerHolder.current = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OfeliaPoopDuty', () => {
  it('shows today and tomorrow in small mode once synced', () => {
    render(<OfeliaPoopDuty {...props('small')} />)

    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('Завтра: Карина')).toBeInTheDocument()
  })

  it('shows today and tomorrow in large mode once synced', () => {
    render(<OfeliaPoopDuty {...props('large')} />)

    expect(screen.getByRole('heading', { name: 'Кто сегодня убирает какахи Офелии' })).toBeInTheDocument()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.getByText('Завтра: Карина')).toBeInTheDocument()
  })

  it('shows a loading state before the first sync', () => {
    timerHolder.current = createFakeTimer()

    render(<OfeliaPoopDuty {...props('small')} />)

    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })
})
