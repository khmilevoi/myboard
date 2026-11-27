// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { monthKeysInRange } from 'module-health/domain/keys'
import type { Measurement } from 'module-health/domain/measurement'
import { makeTestHealthModel } from 'module-health/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  ModuleLoadError,
  WidgetRuntimeContext,
  type StorageApi,
  type WidgetModules,
  type WidgetRuntimeProps,
  type WidgetTier,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'

import { formatTakenAt } from '../model/format'
import { Weight } from './Weight'

const DAY = 86_400_000

function reading(id: string, takenAt: number, kg: number): Measurement {
  return {
    id,
    takenAt,
    metrics: { weight: { value: kg, unit: 'kg' } },
    source: { kind: 'hardware', hardwareId: 'h', model: 'm' },
  }
}

function props(modules: WidgetModules, tier: WidgetTier): WidgetRuntimeProps {
  const storage = createFakeStorage()
  return {
    instanceId: 'weight-1',
    typeId: 'weight',
    mode: tier === 'fullscreen' ? 'large' : 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: {
      instance: { client: storage, server: storage },
      shared: { client: storage, server: storage },
      account: { client: storage, server: storage, files: makeFakeFileSlots() },
    },
    api: { invoke: vi.fn() },
    identity: makeStaticWidgetIdentity(),
    modules,
  }
}

async function renderWeight(measurements: Measurement[], tier: WidgetTier = 'standard') {
  const { model, ready } = makeTestHealthModel({ measurements })
  expect(await ready).toBeUndefined()
  const modules = { get: async () => model } as unknown as WidgetModules
  return render(
    <WidgetRuntimeContext.Provider value={props(modules, tier)}>
      <Weight />
    </WidgetRuntimeContext.Provider>,
  )
}

/** The trend line or chart; the chrome's lucide icons are not charts. */
const chart = (container: HTMLElement) => container.querySelector('svg[role="img"]')
const periodControl = () => screen.queryByRole('group', { name: 'Период' })

afterEach(() => {
  cleanup()
  context.reset()
})

describe('Weight', () => {
  it('shows the latest weight, its date and the change over the period', async () => {
    const takenAt = Date.now() - 2 * DAY
    const { container } = await renderWeight([
      reading('a', Date.now() - 20 * DAY, 84.4),
      reading('b', takenAt, 83),
    ])

    await waitFor(() => expect(screen.getByTestId('weight-value')).toHaveTextContent('83,0 кг'))
    expect(screen.getByTestId('weight-taken-at')).toHaveTextContent(
      formatTakenAt(takenAt, Date.now()),
    )
    expect(screen.getByTestId('weight-delta')).toHaveTextContent('−1,4 кг за 30 дней')
    expect(chart(container)).not.toBeNull()
  })

  it('keeps the latest weight and says so when the period has no readings', async () => {
    const takenAt = Date.now() - 60 * DAY
    await renderWeight([reading('old', takenAt, 84.6)])

    await waitFor(() => expect(screen.getByText('Нет измерений за период')).toBeVisible())
    expect(screen.getByTestId('weight-value')).toHaveTextContent('84,6 кг')
    expect(screen.getByTestId('weight-taken-at')).toHaveTextContent(
      formatTakenAt(takenAt, Date.now()),
    )
    expect(screen.getByText('Выберите период длиннее')).toBeInTheDocument()
    expect(screen.queryByText('Пока нет измерений')).not.toBeInTheDocument()
  })

  it('shows a single reading without a trend line or a delta', async () => {
    const { container } = await renderWeight([reading('a', Date.now() - 3 * DAY, 83)])

    await waitFor(() => expect(screen.getByText('Тренд появится со второго')).toBeVisible())
    expect(screen.getByText('Первое измерение')).toBeInTheDocument()
    expect(screen.getByTestId('weight-value')).toHaveTextContent('83,0 кг')
    expect(screen.queryByTestId('weight-delta')).not.toBeInTheDocument()
    expect(chart(container)).toBeNull()
    expect(container.textContent).not.toMatch(/NaN|−0,0/)
  })

  it('shows the empty state when nothing was ever measured', async () => {
    await renderWeight([])

    await waitFor(() => expect(screen.getByText('Пока нет измерений')).toBeVisible())
    expect(
      screen.getByText('Встаньте на подключённые весы, и вес появится здесь сам.'),
    ).toBeInTheDocument()
    expect(screen.queryByText('Подключить весы')).not.toBeInTheDocument()
  })

  it('offers a retry after the module fails to load, and retrying loads it', async () => {
    const { model, ready } = makeTestHealthModel({
      measurements: [reading('a', Date.now() - 3 * DAY, 83)],
    })
    await ready
    const get = vi
      .fn()
      .mockResolvedValueOnce(new ModuleLoadError({ moduleId: 'health', cause: new Error('x') }))
      .mockResolvedValue(model)
    render(
      <WidgetRuntimeContext.Provider value={props({ get } as unknown as WidgetModules, 'standard')}>
        <Weight />
      </WidgetRuntimeContext.Provider>,
    )

    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.getByText('Не удалось загрузить данные')).toBeInTheDocument()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByTestId('weight-value')).toHaveTextContent('83,0 кг'))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('tiny shows the number and the day, without a period control or a chart', async () => {
    const { container } = await renderWeight(
      [reading('a', Date.now() - 20 * DAY, 84.4), reading('b', Date.now() - 2 * DAY, 83)],
      'tiny',
    )

    await waitFor(() => expect(screen.getByTestId('weight-value')).toHaveTextContent('83,0 кг'))
    expect(screen.getByText('Вес')).toBeInTheDocument()
    expect(periodControl()).toBeNull()
    expect(chart(container)).toBeNull()
  })

  it('compact has a sparkline but no period control', async () => {
    const { container } = await renderWeight(
      [reading('a', Date.now() - 20 * DAY, 84.4), reading('b', Date.now() - 2 * DAY, 83)],
      'compact',
    )

    await waitFor(() => expect(screen.getByTestId('weight-delta')).toHaveTextContent('за 30 дней'))
    expect(periodControl()).toBeNull()
    expect(chart(container)).not.toBeNull()
  })

  it('standard has the period control, and choosing a period widens the series', async () => {
    await renderWeight([
      reading('old', Date.now() - 60 * DAY, 86),
      reading('a', Date.now() - 20 * DAY, 84.4),
      reading('b', Date.now() - 2 * DAY, 83),
    ])

    await waitFor(() => expect(periodControl()).not.toBeNull())
    const ninety = screen.getByRole('button', { name: '90 дней' })
    expect(screen.getByRole('button', { name: '30 дней' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Год' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('weight-delta')).toHaveTextContent('−1,4 кг'))

    fireEvent.click(ninety)
    await waitFor(() =>
      expect(screen.getByTestId('weight-delta')).toHaveTextContent('−3,0 кг за 90 дней'),
    )
    expect(ninety).toHaveAttribute('aria-pressed', 'true')
  })

  it('fullscreen lists every reading of the period under Измерения', async () => {
    await renderWeight(
      [
        reading('a', Date.now() - 9 * DAY, 83.6),
        reading('b', Date.now() - 5 * DAY, 83.3),
        reading('c', Date.now() - 1 * DAY, 83),
      ],
      'fullscreen',
    )

    await waitFor(() => expect(screen.getAllByTestId('weight-row')).toHaveLength(3))
    expect(screen.getByText('Измерения')).toBeInTheDocument()
    expect(screen.getByText('3 за 30 дней')).toBeInTheDocument()
    expect(periodControl()).not.toBeNull()
    const [newest, , oldest] = screen.getAllByTestId('weight-row')
    expect(newest).toHaveTextContent('83,0 кг')
    expect(newest).toHaveTextContent('−0,3')
    expect(oldest).toHaveTextContent('83,6 кг')
  })

  it('keeps the card and the period control mounted while a longer period loads', async () => {
    const now = Date.now()
    const backing = createFakeStorage()
    const seeded = makeTestHealthModel({
      storage: backing,
      measurements: [
        reading('old', now - 60 * DAY, 86),
        reading('a', now - 20 * DAY, 84.4),
        reading('b', now - 2 * DAY, 83),
      ],
    })
    expect(await seeded.ready).toBeUndefined()
    // Month reads outside the 30-day window hang until released.
    const loaded = monthKeysInRange(now - 30 * DAY, now)
    const pending: (() => void)[] = []
    const storage: StorageApi = {
      ...backing,
      subscribe: (key, listener, schema) => {
        if (!key.startsWith('measurements/') || loaded.includes(key)) {
          return backing.subscribe(key, listener, schema)
        }
        let off = () => {}
        pending.push(() => {
          off = backing.subscribe(key, listener, schema)
        })
        return () => off()
      },
    }
    const { model } = makeTestHealthModel({ storage })
    render(
      <WidgetRuntimeContext.Provider
        value={props({ get: async () => model } as unknown as WidgetModules, 'standard')}
      >
        <Weight />
      </WidgetRuntimeContext.Provider>,
    )
    await waitFor(() =>
      expect(screen.getByTestId('weight-delta')).toHaveTextContent('−1,4 кг за 30 дней'),
    )

    const ninety = screen.getByRole('button', { name: '90 дней' })
    fireEvent.click(ninety)
    await waitFor(() => expect(ninety).toHaveAttribute('aria-pressed', 'true'))
    // The 90-day months are being read: the card is not back to its skeleton, the pressed
    // button is the same element, and the 30-day trend stays until the new one arrives.
    await waitFor(() => expect(pending.length).toBeGreaterThan(0))
    expect(screen.queryByLabelText('Загрузка веса')).not.toBeInTheDocument()
    expect(periodControl()).toBeInTheDocument()
    expect(ninety).toBeInTheDocument()
    expect(screen.getByTestId('weight-delta')).toHaveTextContent('−1,4 кг за 30 дней')

    pending.splice(0).forEach((run) => run())
    await waitFor(() =>
      expect(screen.getByTestId('weight-delta')).toHaveTextContent('−3,0 кг за 90 дней'),
    )
    expect(ninety).toBeInTheDocument()
  })
})
