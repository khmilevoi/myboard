// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { foldDebt } from 'module-ofelia/domain/debt'
import type { LedgerEntry } from 'module-ofelia/domain/ledger'
import type { Person } from 'module-ofelia/domain/roster'
import { makeTestOfeliaModel } from 'module-ofelia/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  ModuleLoadError,
  WidgetRuntimeContext,
  type WidgetModules,
  type WidgetRuntimeProps,
} from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { OfeliaStats } from './OfeliaStats'

const TODAY = '2026-06-16'

let nextTs = 1
const entry = (
  type: LedgerEntry['type'],
  date: string,
  actor: Person,
  extra: Partial<LedgerEntry> = {},
): LedgerEntry => {
  const ts = nextTs++
  return { id: `e${ts}`, ts, date, type, actor, ...extra }
}
const cleaned = (date: string, actor: Person) => entry('cleaned', date, actor)

function props(modules: WidgetModules): WidgetRuntimeProps {
  const storage = createFakeStorage()
  return {
    instanceId: 'ofelia-stats-1',
    typeId: 'ofelia-stats',
    mode: 'small',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: {
      instance: { client: storage, server: storage },
      shared: { client: storage, server: storage },
      account: { client: storage, server: storage },
    },
    api: { invoke: vi.fn() },
    identity: makeStaticWidgetIdentity(),
    modules,
  }
}

function renderStats(modules: WidgetModules) {
  return render(
    <WidgetRuntimeContext.Provider value={props(modules)}>
      <OfeliaStats />
    </WidgetRuntimeContext.Provider>,
  )
}

afterEach(() => {
  cleanup()
  context.reset()
})

describe('OfeliaStats', () => {
  it('shows each member cleanings and debt from the module model', async () => {
    const entries = [
      cleaned(TODAY, 'Леша'),
      entry('went_into_debt', '2026-06-15', 'Карина', { onBehalfOf: 'Карина' }),
    ]
    const { model } = makeTestOfeliaModel({ entries, todayIso: TODAY })
    renderStats({ get: async () => model } as unknown as WidgetModules)

    await waitFor(() => expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toBeVisible())
    expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toHaveTextContent(/^1$/)
    expect(screen.getByTestId('ofelia-stats-debt-Карина')).toHaveTextContent(
      new RegExp(`^${foldDebt(entries).Карина ?? 0}$`),
    )
    expect(screen.getAllByText('Уборок за 30 дней').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Долг').length).toBeGreaterThan(0)
  })

  it('shows the loading state while the model has not arrived', () => {
    renderStats({ get: () => new Promise(() => {}) } as unknown as WidgetModules)
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })

  it('shows a retry button after a load error, and retrying loads again', async () => {
    const { model } = makeTestOfeliaModel({ entries: [cleaned(TODAY, 'Леша')], todayIso: TODAY })
    const get = vi
      .fn()
      .mockResolvedValueOnce(new ModuleLoadError({ moduleId: 'ofelia', cause: new Error('x') }))
      .mockResolvedValue(model)
    renderStats({ get } as unknown as WidgetModules)

    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.getByText('Не удалось загрузить данные')).toBeInTheDocument()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toBeVisible())
    expect(get).toHaveBeenCalledTimes(2)
  })
})
