// @vitest-environment jsdom
import { context } from '@reatom/core'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { defaultCatProfile } from 'module-cats/domain/cat'
import { foldDebt } from 'module-cats/domain/debt'
import { CARD_LITTER_KEY, ledgerKey } from 'module-cats/domain/keys'
import type { LedgerEntry } from 'module-cats/domain/ledger'
import { DEFAULT_LITTER_SETTINGS } from 'module-cats/domain/roster'
import type { Person } from 'module-cats/domain/roster'
import {
  makeSettingsDownStorage,
  makeTestCatsModel,
  type MakeTestCatsModelOptions,
} from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  ModuleLoadError,
  StorageError,
  WidgetRuntimeContext,
  type StorageApi,
  type WidgetModules,
  type WidgetRuntimeProps,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'

import { OfeliaStats } from './OfeliaStats'

const TODAY = '2026-06-16'
const EMPTY_TEXT = 'Лоток появится, когда в виджете «Кошки» будет кошка'

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

// Ofelia on her own litter, registered the way the `ofelia-to-cats` migration does.
const OFELIA_REGISTERED: MakeTestCatsModelOptions = {
  catRegistry: [{ id: 'c1', ts: 1, catId: 'ofelia', op: 'add' }],
  litterRegistry: [{ id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' }],
  profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') },
}

const TWO_LITTERS: MakeTestCatsModelOptions = {
  catRegistry: [
    { id: 'c1', ts: 1, catId: 'ofelia', op: 'add' },
    { id: 'c2', ts: 2, catId: 'busya', op: 'add' },
  ],
  litterRegistry: [
    { id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' },
    { id: 'l2', ts: 2, litterId: 'busya', op: 'add' },
  ],
  profiles: {
    ofelia: defaultCatProfile('Офелия', 'ofelia'),
    busya: defaultCatProfile('Буся', 'busya'),
  },
}

const NO_CATS: MakeTestCatsModelOptions = { catRegistry: [], litterRegistry: [] }

function modulesOf(options: MakeTestCatsModelOptions): WidgetModules {
  const { model } = makeTestCatsModel({ todayIso: TODAY, ...options })
  return { get: async () => model } as unknown as WidgetModules
}

function props(
  modules: WidgetModules,
  mode: WidgetRuntimeProps['mode'] = 'small',
): WidgetRuntimeProps {
  const storage = createFakeStorage()
  const instance = createFakeStorage()
  return {
    instanceId: 'ofelia-stats-1',
    typeId: 'ofelia-stats',
    mode,
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: {
      instance: { client: instance, server: instance },
      shared: { client: storage, server: storage },
      account: { client: storage, server: storage, files: makeFakeFileSlots() },
    },
    api: { invoke: vi.fn() },
    identity: makeStaticWidgetIdentity(),
    modules,
  }
}

function renderStats(modules: WidgetModules, widgetProps: WidgetRuntimeProps = props(modules)) {
  return render(
    <WidgetRuntimeContext.Provider value={widgetProps}>
      <OfeliaStats />
    </WidgetRuntimeContext.Provider>,
  )
}

// Radix's DropdownMenuTrigger opens on pointerdown, not on click.
async function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
  return screen.findByRole('menu')
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
    renderStats(modulesOf({ ...OFELIA_REGISTERED, entries }))

    await waitFor(() => expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toBeVisible())
    expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toHaveTextContent(/^1$/)
    expect(screen.getByTestId('ofelia-stats-debt-Карина')).toHaveTextContent(
      new RegExp(`^${foldDebt(DEFAULT_LITTER_SETTINGS, entries).Карина ?? 0}$`),
    )
    expect(screen.getAllByText('Уборок за 30 дней').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Долг').length).toBeGreaterThan(0)
  })

  it('shows the loading state while the model has not arrived', () => {
    renderStats({ get: () => new Promise(() => {}) } as unknown as WidgetModules)
    expect(screen.getByText('Загрузка…')).toBeInTheDocument()
  })

  it('shows a retry button after a load error, and retrying loads again', async () => {
    const { model } = makeTestCatsModel({
      ...OFELIA_REGISTERED,
      entries: [cleaned(TODAY, 'Леша')],
      todayIso: TODAY,
    })
    const get = vi
      .fn()
      .mockResolvedValueOnce(new ModuleLoadError({ moduleId: 'cats', cause: new Error('x') }))
      .mockResolvedValue(model)
    renderStats({ get } as unknown as WidgetModules)

    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.getByText('Не удалось загрузить данные')).toBeInTheDocument()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toBeVisible())
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('shows a retry button when the ledger read fails, and retrying loads the numbers', async () => {
    const entries = [cleaned(TODAY, 'Леша')]
    const storage = createFakeStorage()
    const get = vi.fn(async (key: string) =>
      key === ledgerKey('ofelia') ? entries : null,
    ) as unknown as StorageApi['get']
    // The connect-time ledger read fails; only the retry's `get` succeeds.
    const failing: StorageApi = {
      ...storage,
      get,
      subscribe: (key, listener, schema) => {
        if (key !== ledgerKey('ofelia')) return storage.subscribe(key, listener, schema)
        queueMicrotask(() => listener(new StorageError({ reason: 'offline' })))
        return () => {}
      },
    }
    renderStats(modulesOf({ ...OFELIA_REGISTERED, storage: failing }))

    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.getByText('Не удалось загрузить данные')).toBeInTheDocument()
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toBeVisible())
    expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toHaveTextContent(/^1$/)
    expect(get).toHaveBeenCalledWith(ledgerKey('ofelia'), expect.anything())
  })

  it('shows a retry button when only the settings read fails, through later ledger events', async () => {
    const base = createFakeStorage()
    await base.set(ledgerKey('ofelia'), [cleaned(TODAY, 'Леша')])
    const { storage, recover } = makeSettingsDownStorage(
      base,
      new StorageError({ reason: 'settings down' }),
    )
    renderStats(modulesOf({ ...OFELIA_REGISTERED, storage }))

    await screen.findByRole('button', { name: 'Повторить' })
    // A later ledger event clears the ledger's own error; the settings failure must stay on screen.
    await act(() =>
      base.set(ledgerKey('ofelia'), [cleaned(TODAY, 'Леша'), cleaned('2026-06-14', 'Леша')]),
    )
    expect(screen.getByText('Не удалось загрузить данные')).toBeInTheDocument()
    expect(screen.queryByText('Загрузка…')).not.toBeInTheDocument()

    recover()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toBeVisible())
    expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toHaveTextContent(/^2$/)
  })

  it('titles the card with its litter and offers no switcher for one litter', async () => {
    renderStats(modulesOf(OFELIA_REGISTERED))

    expect(await screen.findByRole('heading', { name: 'Лоток · Офелия' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Выбрать лоток/ })).not.toBeInTheDocument()
  })

  it('follows the chosen litter', async () => {
    const shared = createFakeStorage()
    void shared.set(ledgerKey('ofelia'), [cleaned(TODAY, 'Леша')])
    void shared.set(ledgerKey('busya'), [cleaned(TODAY, 'Карина'), cleaned('2026-06-15', 'Карина')])
    const modules = modulesOf({ ...TWO_LITTERS, storage: shared })
    const widgetProps = props(modules)
    renderStats(modules, widgetProps)

    await waitFor(() =>
      expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toHaveTextContent(/^1$/),
    )
    const menu = await openMenu('Выбрать лоток · сейчас Лоток · Офелия')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Лоток · Буся' }))

    await waitFor(() =>
      expect(screen.getByTestId('ofelia-stats-cleanings-Карина')).toHaveTextContent(/^2$/),
    )
    expect(screen.getByTestId('ofelia-stats-cleanings-Леша')).toHaveTextContent(/^0$/)
    // The heading leaves the accessibility tree while the menu is open; it closes on its own.
    expect(await screen.findByRole('heading', { name: 'Лоток · Буся' })).toBeInTheDocument()
    expect(await widgetProps.storage.instance.server.get(CARD_LITTER_KEY)).toBe('busya')
  })

  it('shows the empty state when no litter is offered', async () => {
    renderStats(modulesOf(NO_CATS))
    expect(await screen.findByRole('status')).toHaveTextContent(EMPTY_TEXT)
  })
})

// Global Constraints, card controls: a card can be removed from the board in every state.
type CardState = {
  name: string
  modules: () => WidgetModules
  reached: () => Promise<unknown>
  ready?: boolean
}

function failingLedger(): StorageApi {
  const storage = createFakeStorage()
  return {
    ...storage,
    subscribe: (key, listener, schema) => {
      if (key !== ledgerKey('ofelia')) return storage.subscribe(key, listener, schema)
      queueMicrotask(() => listener(new StorageError({ reason: 'offline' })))
      return () => {}
    },
  }
}

const STATES: CardState[] = [
  {
    name: 'module loading',
    modules: () => ({ get: () => new Promise(() => {}) }) as unknown as WidgetModules,
    reached: () => screen.findByText('Загрузка…'),
  },
  {
    name: 'module load error',
    modules: () =>
      ({
        get: async () => new ModuleLoadError({ moduleId: 'cats', cause: new Error('x') }),
      }) as unknown as WidgetModules,
    reached: () => screen.findByText('Не удалось загрузить данные'),
  },
  {
    name: 'ledger load error',
    modules: () => modulesOf({ ...OFELIA_REGISTERED, storage: failingLedger() }),
    reached: () => screen.findByText('Не удалось загрузить данные'),
  },
  {
    name: 'no litters',
    modules: () => modulesOf(NO_CATS),
    reached: () => screen.findByText(EMPTY_TEXT),
  },
  {
    name: 'ready',
    modules: () => modulesOf(OFELIA_REGISTERED),
    reached: () => screen.findByTestId('ofelia-stats-cleanings-Леша'),
    ready: true,
  },
]

describe('OfeliaStats card controls', () => {
  it.each(STATES)('$name — one "Удалить" that removes the card', async (state) => {
    const modules = state.modules()
    const widgetProps = props(modules)
    renderStats(modules, widgetProps)
    await state.reached()

    const remove = screen.getAllByRole('button', { name: 'Удалить' })
    expect(remove).toHaveLength(1)
    fireEvent.click(remove[0]!)
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()

    const expand = screen.queryAllByRole('button', { name: 'Развернуть' })
    expect(expand).toHaveLength(state.ready ? 1 : 0)
  })

  it.each(STATES)('$name — the fullscreen mount offers only "Закрыть"', async (state) => {
    const modules = state.modules()
    renderStats(modules, props(modules, 'large'))
    await state.reached()

    expect(screen.getAllByRole('button', { name: 'Закрыть' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
  })
})
