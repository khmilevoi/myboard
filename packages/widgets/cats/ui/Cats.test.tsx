// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { defaultCatProfile, type CatProfile, type Weighing } from 'module-cats/domain/cat'
import { catProfileKey, catWeightKey } from 'module-cats/domain/keys'
import type { CatRegistryEvent, LitterRegistryEvent } from 'module-cats/domain/registry'
import {
  makeKeysDownStorage,
  makeTestCatsModel,
  type MakeTestCatsModelOptions,
  type TestModelCalls,
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
  type WidgetTier,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'

import { Cats } from './Cats'

const TODAY = '2026-11-26'
const LOADING_LABEL = 'Загрузка виджета «Кошки»'
const LOAD_ERROR = 'Не удалось загрузить виджет «Кошки»'
const SWITCHER = /^Выбрать кошку/

const catEvent = (catId: string, ts: number): CatRegistryEvent => ({
  id: `c${ts}`,
  ts,
  catId,
  op: 'add',
})
const litterEvent = (litterId: string, ts: number): LitterRegistryEvent => ({
  id: `l${ts}`,
  ts,
  litterId,
  op: 'add',
})

const OFELIA: CatProfile = {
  ...defaultCatProfile('Офелия', 'ofelia'),
  breed: 'Британская короткошёрстная',
  birthDate: '2023-09-20',
  sex: 'female',
  sterilized: 'yes',
  bodyCondition: 5,
}
const BUSYA: CatProfile = { ...defaultCatProfile('Буся', 'busya'), breed: 'Беспородная' }

const ONE_CAT: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('ofelia', 1)],
  litterRegistry: [litterEvent('ofelia', 1)],
  profiles: { ofelia: OFELIA },
}
const TWO_CATS: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('ofelia', 1), catEvent('busya', 2)],
  litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
  profiles: { ofelia: OFELIA, busya: BUSYA },
}
const NO_CATS: MakeTestCatsModelOptions = { catRegistry: [], litterRegistry: [] }

const weighing = (at: string, kg: number, ts = 1): Weighing => ({
  id: `w-${at}`,
  ts,
  at,
  kg,
  createdBy: { accountId: 'acc-lesha', name: 'Леша' },
})

let nextInstance = 1

type Setup = {
  props: WidgetRuntimeProps
  calls: TestModelCalls
}

function setup(
  options: MakeTestCatsModelOptions = ONE_CAT,
  overrides: Partial<WidgetRuntimeProps> = {},
  shared: StorageApi = createFakeStorage(),
): Setup {
  void shared.set(catWeightKey('ofelia'), [
    weighing('2026-10-20', 4.4),
    weighing('2026-11-21', 4.32, 2),
  ])
  const { model, calls } = makeTestCatsModel({ todayIso: TODAY, storage: shared, ...options })
  const instance = createFakeStorage()
  const props: WidgetRuntimeProps = {
    // A fresh instance per test: the card store keeps one card per instance id.
    instanceId: `cats-${nextInstance++}`,
    typeId: 'cats',
    mode: 'small',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: {
      instance: { client: instance, server: instance },
      shared: { client: shared, server: shared },
      account: { client: shared, server: shared, files: makeFakeFileSlots() },
    },
    api: { invoke: vi.fn() },
    identity: makeStaticWidgetIdentity(),
    modules: { get: async () => model } as unknown as WidgetModules,
    ...overrides,
  }
  return { props, calls }
}

function renderCats(props: WidgetRuntimeProps) {
  return render(
    <WidgetRuntimeContext.Provider value={props}>
      <Cats />
    </WidgetRuntimeContext.Provider>,
  )
}

// Radix's DropdownMenuTrigger opens on pointerdown, not on click.
function openSwitcher() {
  fireEvent.pointerDown(screen.getByRole('button', { name: SWITCHER }), {
    button: 0,
    ctrlKey: false,
  })
  return screen.findByRole('menu')
}

afterEach(() => {
  cleanup()
  context.reset()
})

describe('Cats — tiers', () => {
  it('standard, one cat: the passport and no switcher', async () => {
    renderCats(setup().props)

    expect(await screen.findByRole('heading', { name: 'Офелия' })).toBeInTheDocument()
    expect(screen.getByText('Британская короткошёрстная')).toBeInTheDocument()
    expect(screen.getByText('3 года 2 мес · кошка · стерилизована')).toBeInTheDocument()
    expect(screen.getByText(/взвешивали 5 дней назад/)).toBeInTheDocument()
    expect(screen.getByText('−80 г за месяц')).toBeInTheDocument()
    expect(screen.getByText('5 / 9')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SWITCHER })).not.toBeInTheDocument()
  })

  it('standard, two cats: the switcher changes the card to Буся', async () => {
    renderCats(setup(TWO_CATS).props)
    await screen.findByRole('heading', { name: 'Офелия' })

    const menu = await openSwitcher()
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Буся' }))

    expect(await screen.findByRole('heading', { name: 'Буся' })).toBeInTheDocument()
    expect(screen.getByText('Беспородная')).toBeInTheDocument()
  })

  it('leaves out what the profile does not say, never a dash', async () => {
    const bare = { ...ONE_CAT, profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') } }
    renderCats(setup(bare).props)

    await screen.findByRole('heading', { name: 'Офелия' })
    expect(screen.queryByText('—')).not.toBeInTheDocument()
    expect(screen.queryByText(/Упитанность/)).not.toBeInTheDocument()
  })

  it('warns when the weight is two weeks old, with a Взвесить link', async () => {
    const shared = createFakeStorage()
    const { props } = setup(ONE_CAT, {}, shared)
    void shared.set(catWeightKey('ofelia'), [weighing('2026-11-12', 4.32)])
    renderCats(props)

    expect(
      await screen.findByText(
        'Не взвешивали две недели — цель по калориям считается по старому весу',
      ),
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Взвесить' })).toHaveLength(2)
  })

  it('"Взвесить" opens the dialog, and "4,30" is weighed as 4.3', async () => {
    const { props, calls } = setup()
    renderCats(props)
    await screen.findByRole('heading', { name: 'Офелия' })

    fireEvent.click(screen.getByRole('button', { name: 'Взвесить' }))
    const dialog = await screen.findByRole('dialog', { name: 'Вес · Офелия' })
    fireEvent.change(within(dialog).getByLabelText('Сколько весит'), {
      target: { value: '4,30' },
    })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить вес' }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        action: 'weigh',
        payload: { catId: 'ofelia', kg: 4.3, at: TODAY },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('"Профиль" opens the profile tab in fullscreen', async () => {
    const { props } = setup()
    renderCats(props)
    await screen.findByRole('heading', { name: 'Офелия' })

    fireEvent.click(screen.getByRole('button', { name: 'Профиль' }))
    expect(props.requestFullscreen).toHaveBeenCalledOnce()
  })

  it('compact: breed and short age, weight with the monthly trend', async () => {
    renderCats(setup(ONE_CAT, { tier: 'compact' }).props)

    expect(await screen.findByText('Британская короткошёрстная · 3 года')).toBeInTheDocument()
    expect(screen.getByText('−80 г/мес')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: SWITCHER })).not.toBeInTheDocument()
  })

  // A phone's single column is a tall compact card: it carries the quick actions (shown by
  // height in CSS), and a cat never weighed has them as its only status.
  it('compact, never weighed: "Взвесить" opens the form and "Профиль" opens fullscreen', async () => {
    const shared = createFakeStorage()
    const { props } = setup(ONE_CAT, { tier: 'compact' }, shared)
    void shared.set(catWeightKey('ofelia'), [])
    const { container } = renderCats(props)

    await screen.findByText('Британская короткошёрстная · 3 года')
    expect(screen.queryByText(/кг/)).not.toBeInTheDocument()
    expect(container.querySelector('[data-weighed]')).toHaveAttribute('data-weighed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Профиль' }))
    expect(props.requestFullscreen).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Взвесить' }))
    expect(await screen.findByRole('dialog', { name: 'Вес · Офелия' })).toBeInTheDocument()
  })

  it('tiny: the name and the weight, and no switcher even with two cats', async () => {
    renderCats(setup(TWO_CATS, { tier: 'tiny' }).props)

    expect(await screen.findByText('Офелия')).toBeInTheDocument()
    expect(screen.getByTestId('cats-weight')).toHaveTextContent('4,32 кг')
    expect(screen.queryByRole('button', { name: SWITCHER })).not.toBeInTheDocument()
  })

  it('no cats: "Кошек пока нет" and the add button opens the "Новая кошка" form right there', async () => {
    const { props } = setup(NO_CATS)
    renderCats(props)

    expect(await screen.findByText('Кошек пока нет')).toBeInTheDocument()
    expect(
      screen.getByText('Добавьте кошку — её увидят все кошачьи карточки на борде.'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Добавить кошку' }))
    expect(await screen.findByRole('dialog', { name: 'Новая кошка' })).toBeInTheDocument()
    // No fullscreen detour: the form is the first thing the card needs.
    expect(props.requestFullscreen).not.toHaveBeenCalled()
  })

  it('no cats: the form adds the first cat with a litter of her own', async () => {
    const { props, calls } = setup(NO_CATS)
    renderCats(props)

    fireEvent.click(await screen.findByRole('button', { name: '+ Добавить кошку' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Новая кошка' }))
    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: 'Буся' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Добавить кошку' }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        action: 'addCat',
        payload: { name: 'Буся', litter: { kind: 'new' }, birthDate: null, sex: 'female' },
      }),
    )
  })

  it('module error: "Повторить" loads again', async () => {
    const { props } = setup()
    const { model } = makeTestCatsModel({ todayIso: TODAY, ...ONE_CAT })
    const get = vi
      .fn()
      .mockResolvedValueOnce(new ModuleLoadError({ moduleId: 'cats' }))
      .mockResolvedValue(model)
    props.modules = { get } as unknown as WidgetModules
    renderCats(props)

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Офелия' })).toBeInTheDocument()
    expect(get).toHaveBeenCalledTimes(2)
  })
})

/** A shared scope whose cat weight key fails to read until `recover()`. */
function weightDownStorage() {
  return makeKeysDownStorage(
    createFakeStorage(),
    [catWeightKey('ofelia')],
    new StorageError({ reason: 'boom' }),
  )
}

describe('Cats read errors', () => {
  it('a failed weight read: "Повторить" reads it again', async () => {
    const { storage, recover } = weightDownStorage()
    const { props } = setup(ONE_CAT, {}, storage)
    renderCats(props)

    expect(await screen.findByText(LOAD_ERROR)).toBeInTheDocument()
    recover()
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(await screen.findByRole('heading', { name: 'Офелия' })).toBeInTheDocument()
  })
})

// Global Constraints, card controls: a card can be removed from the board in every state.
type CardState = {
  name: string
  tier?: WidgetTier
  setup: () => Setup
  reached: () => Promise<unknown>
  ready?: boolean
}

/** A shared scope whose cat profile never answers: the registry is read, the profile is not. */
function profilePendingStorage(): StorageApi {
  const storage = createFakeStorage()
  return {
    ...storage,
    subscribe: (key, listener, schema) =>
      key === catProfileKey('ofelia') ? () => {} : storage.subscribe(key, listener, schema),
  }
}

const STATES: CardState[] = [
  {
    name: 'module loading',
    setup: () => setup(ONE_CAT, { modules: { get: () => new Promise(() => {}) } as never }),
    reached: () => screen.findByLabelText(LOADING_LABEL),
  },
  {
    name: 'module load error',
    setup: () =>
      setup(ONE_CAT, {
        modules: { get: async () => new ModuleLoadError({ moduleId: 'cats' }) } as never,
      }),
    reached: () => screen.findByText(LOAD_ERROR),
  },
  {
    name: 'profile loading',
    setup: () => setup(ONE_CAT, {}, profilePendingStorage()),
    reached: () => screen.findByLabelText(LOADING_LABEL),
  },
  {
    name: 'weight read error',
    setup: () => setup(ONE_CAT, {}, weightDownStorage().storage),
    reached: () => screen.findByText(LOAD_ERROR),
  },
  {
    name: 'no cats',
    setup: () => setup(NO_CATS),
    reached: () => screen.findByText('Кошек пока нет'),
  },
  {
    name: 'tiny',
    tier: 'tiny',
    setup: () => setup(ONE_CAT, { tier: 'tiny' }),
    reached: () => screen.findByTestId('cats-weight'),
    ready: true,
  },
  {
    name: 'compact',
    tier: 'compact',
    setup: () => setup(ONE_CAT, { tier: 'compact' }),
    reached: () => screen.findByText('−80 г/мес'),
    ready: true,
  },
  {
    name: 'standard',
    setup: () => setup(),
    reached: () => screen.findByRole('heading', { name: 'Офелия' }),
    ready: true,
  },
]

describe('Cats card controls', () => {
  it.each(STATES)('$name — one "Удалить" that removes the card', async (state) => {
    const { props } = state.setup()
    renderCats(props)
    await state.reached()

    const remove = screen.getAllByRole('button', { name: 'Удалить' })
    expect(remove).toHaveLength(1)
    fireEvent.click(remove[0]!)
    expect(props.requestDelete).toHaveBeenCalledOnce()

    const expand = screen.queryAllByRole('button', { name: 'Развернуть' })
    expect(expand).toHaveLength(state.ready ? 1 : 0)
  })

  it.each(STATES)('$name — the fullscreen mount offers only "Закрыть"', async (state) => {
    const { props } = state.setup()
    props.mode = 'large'
    props.tier = state.tier === undefined ? 'fullscreen' : state.tier
    renderCats(props)
    await state.reached()

    expect(screen.getAllByRole('button', { name: 'Закрыть' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()
  })
})
