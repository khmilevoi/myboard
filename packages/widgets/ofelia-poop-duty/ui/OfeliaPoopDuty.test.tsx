// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { catsModule, type CatsModel } from 'module-cats'
import { defaultCatProfile } from 'module-cats/domain/cat'
import {
  CARD_LITTER_KEY,
  CATS_REGISTRY_KEY,
  LITTERS_REGISTRY_KEY,
  catProfileKey,
  ledgerKey,
} from 'module-cats/domain/keys'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  ModuleLoadError,
  StorageError,
  type ServerTime,
  type StorageApi,
  type WidgetModules,
  type WidgetRuntimeProps,
  WidgetRuntimeContext,
  type WidgetStorage,
  type WidgetTier,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const TODAY = '2026-06-16'
const LOADING_LABEL = 'Загрузка виджета «Лоток»'
const EMPTY_TEXT = 'Лоток появится, когда в виджете «Кошки» будет кошка'

type SeedCat = { id: string; name: string; litterId: string }

const OFELIA_ONLY: SeedCat[] = [{ id: 'ofelia', name: 'Офелия', litterId: 'ofelia' }]
const TWO_LITTERS: SeedCat[] = [...OFELIA_ONLY, { id: 'busya', name: 'Буся', litterId: 'busya' }]

const timerHolder = { current: null as ServerTime | null }

// Builds the real cats module model, at mount time, over whatever storage the
// test left on the props — the same shape the host's module registry hands out.
async function loadCatsModel(widgetProps: WidgetRuntimeProps): Promise<CatsModel> {
  const loadModel = catsModule.loadModel
  if (!loadModel || !timerHolder.current) throw new Error('test setup: no model loader or timer')
  const factory = await loadModel()
  return factory({
    moduleId: catsModule.id,
    storage: { shared: widgetProps.storage.shared },
    files: makeFakeFileSlots(),
    api: { invoke: vi.fn() } as never,
    timer: timerHolder.current,
    identity: widgetProps.identity,
  })
}

function fakeModules(load: () => Promise<unknown>): WidgetModules {
  return { get: load } as unknown as WidgetModules
}

/** Registers the cats and their litters the way the `ofelia-to-cats` migration does. */
function seedCats(server: StorageApi, cats: SeedCat[]): void {
  void server.set(
    CATS_REGISTRY_KEY,
    cats.map((cat, ts) => ({ id: `c${ts}`, ts, catId: cat.id, op: 'add' })),
  )
  const litterIds = [...new Set(cats.map((cat) => cat.litterId))]
  void server.set(
    LITTERS_REGISTRY_KEY,
    litterIds.map((litterId, ts) => ({ id: `l${ts}`, ts, litterId, op: 'add' })),
  )
  for (const cat of cats)
    void server.set(catProfileKey(cat.id), defaultCatProfile(cat.name, cat.litterId))
}

function fakeWidgetStorage(sharedServer: StorageApi = createFakeStorage()): WidgetStorage {
  return {
    instance: { client: createFakeStorage(), server: createFakeStorage() },
    shared: { client: createFakeStorage(), server: sharedServer },
    account: {
      client: createFakeStorage(),
      server: createFakeStorage(),
      files: makeFakeFileSlots(),
    },
  }
}

type PropsOptions = {
  cats?: SeedCat[]
  mode?: WidgetRuntimeProps['mode']
  sharedServer?: StorageApi
}

function props(tier: WidgetTier, options: PropsOptions = {}): WidgetRuntimeProps {
  const sharedServer = options.sharedServer ?? createFakeStorage()
  seedCats(sharedServer, options.cats ?? OFELIA_ONLY)
  const widgetProps: WidgetRuntimeProps = {
    instanceId: 'ofelia-poop-duty-1',
    typeId: 'ofelia-poop-duty',
    mode: options.mode ?? 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: fakeWidgetStorage(sharedServer),
    api: { invoke: vi.fn() },
    identity: makeStaticWidgetIdentity(),
    modules: fakeModules(() => loadCatsModel(widgetProps)),
  }
  return widgetProps
}

function renderWidget(widgetProps: WidgetRuntimeProps) {
  return render(
    <WidgetRuntimeContext.Provider value={widgetProps}>
      <OfeliaPoopDuty />
    </WidgetRuntimeContext.Provider>,
  )
}

beforeEach(() => {
  timerHolder.current = createFakeTimer({ today: Temporal.PlainDate.from(TODAY) })
})

afterEach(() => {
  cleanup()
  context.reset()
  vi.clearAllMocks()
})

async function waitForLoaded() {
  await waitFor(() => {
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument()
  })
}

describe('OfeliaPoopDuty tier routing', () => {
  it('tiny — shows only the current person', async () => {
    renderWidget(props('tiny'))
    await screen.findByText('Леша')
    expect(screen.queryByText('Сегодня убирает')).not.toBeInTheDocument()
  })

  it('compact — shows the litter title and the icon actions', async () => {
    renderWidget(props('compact'))
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: 'Лоток · Офелия' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
  })

  it('standard — shows the card title and the confirm button', async () => {
    renderWidget(props('standard'))
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: 'Лоток · Офелия' })).toBeInTheDocument()
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

  it('large — titles the card with the litter and its rotation', async () => {
    renderWidget(props('large'))
    await waitForLoaded()
    expect(screen.getByRole('heading', { name: 'Лоток · Офелия' })).toBeInTheDocument()
    expect(screen.getByText('Кто убирает · Леша и Карина по очереди')).toBeInTheDocument()
  })

  it('fullscreen — offers a close control', async () => {
    // Every widget must give the user a way out of fullscreen: a phone has no
    // Esc key, and the dialog panel leaves only a few pixels of backdrop to hit.
    const widgetProps = props('fullscreen', { mode: 'large' })
    renderWidget(widgetProps)
    await waitForLoaded()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(widgetProps.requestClose).toHaveBeenCalledOnce()
  })

  it('shows a loading state before the first server-time sync', () => {
    timerHolder.current = createFakeTimer()
    renderWidget(props('standard'))
    expect(screen.getByLabelText(LOADING_LABEL)).toHaveAttribute('data-slot', 'skeleton')
  })
})

// Radix's DropdownMenuTrigger opens on pointerdown, not on click.
async function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
  return screen.findByRole('menu')
}

describe('OfeliaPoopDuty litter choice', () => {
  it('one litter — titles the card and offers no switcher', async () => {
    renderWidget(props('standard'))
    await waitForLoaded()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Лоток · Офелия')
    expect(screen.queryByRole('button', { name: /^Выбрать лоток/ })).not.toBeInTheDocument()
  })

  it('two litters — switches to the chosen litter’s ledger and stores the choice', async () => {
    const widgetProps = props('standard', { cats: TWO_LITTERS })
    // Busya's litter is cleaned today; Ofelia's is still pending.
    void widgetProps.storage.shared.server.set(ledgerKey('busya'), [
      { id: 'b1', ts: 1, date: TODAY, type: 'cleaned', actor: 'Леша' },
    ])
    renderWidget(widgetProps)
    await waitForLoaded()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()

    const menu = await openMenu('Выбрать лоток · сейчас Лоток · Офелия')
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Лоток · Буся' }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Лоток · Буся')
    })
    expect(await screen.findByText('Уборка подтверждена')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Буся' }),
    ).toBeVisible()
    expect(await widgetProps.storage.instance.server.get(CARD_LITTER_KEY)).toBe('busya')
  })

  it('shows the stored litter', async () => {
    const widgetProps = props('standard', { cats: TWO_LITTERS })
    void widgetProps.storage.instance.server.set(CARD_LITTER_KEY, 'busya')
    renderWidget(widgetProps)
    await waitForLoaded()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Лоток · Буся')
  })

  it('no litters — shows the empty state instead of a hard-coded litter', async () => {
    renderWidget(props('standard', { cats: [] }))
    expect(await screen.findByRole('status')).toHaveTextContent(EMPTY_TEXT)
    expect(screen.queryByRole('button', { name: 'Какашки убраны' })).not.toBeInTheDocument()
  })

  it('no litters, tiny — the empty text with the corner controls instead of a header', async () => {
    const widgetProps = props('tiny', { cats: [] })
    renderWidget(widgetProps)

    expect(await screen.findByRole('status')).toHaveTextContent(EMPTY_TEXT)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
  })
})

// F2c: a failed initial ledger read used to leave `ledger` pinned at its
// `null` sentinel forever — every derived computed collapsed to null,
// `view.ready` never flipped, and the widget sat on the loading skeleton
// with no error and no way out.
function failingLedgerStorage(): StorageApi {
  const base = createFakeStorage()
  return {
    ...base,
    set: base.set,
    subscribe: vi.fn((key: string, listener: (event: unknown) => void, schema?: unknown) => {
      if (key === ledgerKey('ofelia')) {
        listener(new StorageError({ reason: 'boom' }))
        return () => {}
      }
      return base.subscribe(key, listener as never, schema as never)
    }) as unknown as StorageApi['subscribe'],
    get: vi.fn(async (key: string, schema?: never) =>
      key === ledgerKey('ofelia') ? [] : base.get(key, schema),
    ) as unknown as StorageApi['get'],
  }
}

describe('OfeliaPoopDuty ledger load failure (F2c)', () => {
  it('shows a retry affordance instead of an endless skeleton, and recovers on retry', async () => {
    renderWidget(props('standard', { sharedServer: failingLedgerStorage() }))

    // Never an endless skeleton: the failed read resolves to a real failure
    // state with a retry action, not the loading placeholder.
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.queryByLabelText(LOADING_LABEL)).not.toBeInTheDocument()

    fireEvent.click(retry)

    await waitForLoaded()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Лоток · Офелия')
  })
})

// The board renders under StrictMode, which mounts, unmounts and remounts in
// one commit — the module load must survive that and still reach the tree.
describe('OfeliaPoopDuty under StrictMode', () => {
  it('loads the module and renders the widget', async () => {
    render(
      <StrictMode>
        <WidgetRuntimeContext.Provider value={props('standard')}>
          <OfeliaPoopDuty />
        </WidgetRuntimeContext.Provider>
      </StrictMode>,
    )

    await waitForLoaded()
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Лоток · Офелия')
  })
})

describe('OfeliaPoopDuty module load failure', () => {
  it('shows the error state with a retry when the module chunk fails, and recovers on retry', async () => {
    const widgetProps = props('standard')
    const get = vi
      .fn()
      .mockResolvedValueOnce(new ModuleLoadError({ moduleId: 'cats' }))
      .mockImplementationOnce(() => loadCatsModel(widgetProps))
    widgetProps.modules = fakeModules(get)
    renderWidget(widgetProps)

    // Neither blank nor an endless skeleton: the failed load is a real error
    // state with a way out.
    const retry = await screen.findByRole('button', { name: 'Повторить' })
    expect(screen.getByText('Не удалось загрузить виджет «Лоток»')).toBeInTheDocument()
    expect(screen.queryByLabelText(LOADING_LABEL)).not.toBeInTheDocument()

    fireEvent.click(retry)

    await waitForLoaded()
    expect(get).toHaveBeenCalledTimes(2)
  })
})

// Global Constraints, card controls: a card can be removed from the board in every state.
type CardState = {
  name: string
  setup: (widgetProps: WidgetRuntimeProps) => void
  reached: () => Promise<unknown>
  ready?: boolean
}

const STATES: CardState[] = [
  {
    name: 'module loading',
    setup: (widgetProps) => {
      widgetProps.modules = fakeModules(() => new Promise(() => {}))
    },
    reached: () => screen.findByLabelText(LOADING_LABEL),
  },
  {
    name: 'module load error',
    setup: (widgetProps) => {
      widgetProps.modules = fakeModules(async () => new ModuleLoadError({ moduleId: 'cats' }))
    },
    reached: () => screen.findByText('Не удалось загрузить виджет «Лоток»'),
  },
  {
    name: 'server time not synced',
    setup: () => {
      timerHolder.current = createFakeTimer()
    },
    reached: () => screen.findByLabelText(LOADING_LABEL),
  },
  {
    name: 'ledger load error',
    setup: (widgetProps) => {
      const failing = failingLedgerStorage()
      seedCats(failing, OFELIA_ONLY)
      widgetProps.storage = fakeWidgetStorage(failing)
    },
    reached: () => screen.findByRole('button', { name: 'Повторить' }),
  },
  {
    name: 'no litters',
    setup: (widgetProps) => {
      widgetProps.storage = fakeWidgetStorage()
    },
    reached: () => screen.findByText(EMPTY_TEXT),
  },
  {
    name: 'ready',
    setup: () => {},
    reached: () => screen.findByRole('heading', { name: 'Лоток · Офелия' }),
    ready: true,
  },
]

describe('OfeliaPoopDuty card controls', () => {
  it.each(STATES)('$name — one "Удалить" that removes the card', async (state) => {
    const widgetProps = props('standard')
    state.setup(widgetProps)
    renderWidget(widgetProps)
    await state.reached()

    const remove = screen.getAllByRole('button', { name: 'Удалить' })
    expect(remove).toHaveLength(1)
    fireEvent.click(remove[0]!)
    expect(widgetProps.requestDelete).toHaveBeenCalledOnce()

    const expand = screen.queryAllByRole('button', { name: 'Развернуть' })
    expect(expand).toHaveLength(state.ready ? 1 : 0)
  })

  it.each(STATES)('$name — the fullscreen mount offers only "Закрыть"', async (state) => {
    const widgetProps = props('fullscreen', { mode: 'large' })
    state.setup(widgetProps)
    renderWidget(widgetProps)
    await state.reached()

    expect(screen.getAllByRole('button', { name: 'Закрыть' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
  })
})
