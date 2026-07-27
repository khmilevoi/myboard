// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  StorageError,
  type ServerTime,
  type StorageApi,
  type WidgetRuntimeProps,
  WidgetRuntimeContext,
  type WidgetStorage,
  type WidgetTier,
} from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { LEDGER_KEY } from '@/domain/ledger'

import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const timerHolder = vi.hoisted(() => ({ current: null as ServerTime | null }))

vi.mock('widget-runtime', async () => {
  const actual = await vi.importActual<typeof import('widget-runtime')>('widget-runtime')

  return {
    ...actual,
    getServerTime: () => timerHolder.current,
  }
})

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
    identity: makeStaticWidgetIdentity(),
  }
}

function renderWidget(widgetProps: WidgetRuntimeProps) {
  return render(
    <WidgetRuntimeContext.Provider value={widgetProps}>
      <OfeliaPoopDuty />
    </WidgetRuntimeContext.Provider>,
  )
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
    renderWidget(props('tiny'))
    await waitForLoaded()
    expect(screen.getByText('Леша')).toBeInTheDocument()
    expect(screen.queryByText('Сегодня убирает')).not.toBeInTheDocument()
  })

  it('compact — shows the label and the icon actions', async () => {
    renderWidget(props('compact'))
    await waitForLoaded()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('standard — shows the card title and the confirm button', async () => {
    renderWidget(props('standard'))
    await waitForLoaded()
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('standard — draws its own expand/delete controls wired to runtime callbacks', async () => {
    const widgetProps = props('standard')
    renderWidget(widgetProps)
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(widgetProps.requestFullscreen).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()
  })

  it('fullscreen — has no expand/delete controls of its own', async () => {
    renderWidget(props('fullscreen'))
    await waitForLoaded()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
  })

  it('large — shows the week navigation and the empty history/comments', async () => {
    renderWidget(props('large'))
    await waitForLoaded()
    expect(screen.getByText('Неделя')).toBeInTheDocument()
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('fullscreen — exposes the close affordance', async () => {
    renderWidget(props('fullscreen'))
    await waitForLoaded()
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
  })

  it('shows a loading state before the first server-time sync', () => {
    timerHolder.current = createFakeTimer()
    renderWidget(props('standard'))
    expect(screen.getByLabelText('Загрузка виджета Офелии')).toHaveAttribute(
      'data-slot',
      'skeleton',
    )
  })
})

// F2c: a failed initial ledger read used to leave `ledger` pinned at its
// `null` sentinel forever — every derived computed collapsed to null,
// `view.ready` never flipped, and the widget sat on the loading skeleton
// with no error and no way out.
function fakeWidgetStorageWithFailingLedger(): WidgetStorage {
  const instanceClient = createFakeStorage()
  const instanceServer = createFakeStorage()
  const sharedClient = createFakeStorage()
  const baseSharedServer = createFakeStorage()

  const sharedServer: StorageApi = {
    ...baseSharedServer,
    subscribe: vi.fn((key: string, listener: (event: unknown) => void, schema?: unknown) => {
      if (key === LEDGER_KEY) {
        listener(new StorageError({ reason: 'boom' }))
        return () => {}
      }
      return baseSharedServer.subscribe(key, listener as never, schema as never)
    }) as unknown as StorageApi['subscribe'],
    get: vi.fn(async (key: string) =>
      key === LEDGER_KEY ? [] : null,
    ) as unknown as StorageApi['get'],
  }

  return {
    instance: { client: instanceClient, server: instanceServer },
    shared: { client: sharedClient, server: sharedServer },
  }
}

describe('OfeliaPoopDuty ledger load failure (F2c)', () => {
  it('shows a retry affordance instead of an endless skeleton, and recovers on retry', async () => {
    const widgetProps = props('standard')
    widgetProps.storage = fakeWidgetStorageWithFailingLedger()
    renderWidget(widgetProps)

    // Never an endless skeleton: the failed read resolves to a real failure
    // state with a retry action, not the loading placeholder.
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.queryByLabelText('Загрузка виджета Офелии')).not.toBeInTheDocument()

    fireEvent.click(retry)

    await waitFor(() => {
      expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    })
  })
})
