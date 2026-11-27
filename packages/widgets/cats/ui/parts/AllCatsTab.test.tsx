// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { defaultCatProfile, type CatProfile } from 'module-cats/domain/cat'
import { CARD_CAT_KEY, catWeightKey } from 'module-cats/domain/keys'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  ModuleApiError,
  WidgetRuntimeContext,
  type WidgetModules,
  type WidgetRuntimeProps,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'

import { Cats } from '../Cats'
import { LAST_CAT_HINT } from './AllCatsTab'

const TODAY = '2026-11-26'

const OFELIA: CatProfile = {
  ...defaultCatProfile('Офелия', 'ofelia'),
  breed: 'Британская короткошёрстная',
  birthDate: '2023-09-12',
}
const BUSYA: CatProfile = {
  ...defaultCatProfile('Буся', 'busya'),
  breed: 'Беспородная',
  litterId: 'busya',
}

const ONE_CAT: MakeTestCatsModelOptions = {
  catRegistry: [{ id: 'c1', ts: 1, catId: 'ofelia', op: 'add' }],
  litterRegistry: [{ id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' }],
  profiles: { ofelia: OFELIA },
}
const TWO_CATS: MakeTestCatsModelOptions = {
  catRegistry: [
    { id: 'c1', ts: 1, catId: 'ofelia', op: 'add' },
    { id: 'c2', ts: 2, catId: 'busya', op: 'add' },
  ],
  litterRegistry: [
    { id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' },
    { id: 'l2', ts: 2, litterId: 'busya', op: 'add' },
  ],
  profiles: { ofelia: OFELIA, busya: BUSYA },
}
const ARCHIVED: MakeTestCatsModelOptions = {
  ...TWO_CATS,
  catRegistry: [
    ...(TWO_CATS.catRegistry ?? []),
    { id: 'c3', ts: Date.parse('2026-05-03T10:00:00Z'), catId: 'busya', op: 'archive' },
  ],
}

let nextInstance = 1

function setup(
  options: MakeTestCatsModelOptions = TWO_CATS,
  overrides: Partial<WidgetRuntimeProps> = {},
) {
  const shared = createFakeStorage()
  void shared.set(catWeightKey('ofelia'), [
    { id: 'w1', ts: 1, at: '2026-11-21', kg: 4.32, createdBy: { accountId: 'a', name: 'Леша' } },
  ])
  const { model, calls } = makeTestCatsModel({
    todayIso: TODAY,
    storage: shared,
    invoke: async (action) => (action === 'addCat' ? { ok: true, catId: 'new-cat' } : { ok: true }),
    ...options,
  })
  const instance = createFakeStorage()
  const props: WidgetRuntimeProps = {
    instanceId: `cats-all-${nextInstance++}`,
    typeId: 'cats',
    mode: 'large',
    tier: 'fullscreen',
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
  render(
    <WidgetRuntimeContext.Provider value={props}>
      <Cats />
    </WidgetRuntimeContext.Provider>,
  )
  return { props, calls, instance }
}

afterEach(() => {
  cleanup()
  context.reset()
})

async function openAllTab() {
  const tabs = within(await screen.findByRole('group', { name: 'Разделы' }))
  fireEvent.click(tabs.getByRole('button', { name: 'Все кошки' }))
  return within(await screen.findByRole('region', { name: 'Все кошки' }))
}

describe('AllCatsTab', () => {
  it('lists the cats with their line, "Открыть" and "В архив"', async () => {
    setup()
    const tab = await openAllTab()

    expect(await tab.findByText('Кошки на борде · 2')).toBeInTheDocument()
    const rows = within(tab.getByRole('list', { name: 'Кошки на борде' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Офелия')
    expect(rows[0]).toHaveTextContent('Британская · 3 года · 4,32 кг · Лоток · Офелия')
    expect(rows[1]).toHaveTextContent('Буся')
    expect(rows[1]).toHaveTextContent('Беспородная · Лоток · Буся')
    for (const row of rows) {
      expect(within(row).getByRole('button', { name: 'Открыть' })).toBeInTheDocument()
      expect(within(row).getByRole('button', { name: 'В архив' })).not.toHaveAttribute(
        'aria-disabled',
      )
    }
    expect(tab.queryByText(LAST_CAT_HINT)).not.toBeInTheDocument()
  })

  it('"Открыть" chooses the cat and shows her profile', async () => {
    const { instance } = setup()
    const tab = await openAllTab()
    const rows = within(await tab.findByRole('list', { name: 'Кошки на борде' }))

    fireEvent.click(
      within(rows.getAllByRole('listitem')[1]!).getByRole('button', { name: 'Открыть' }),
    )

    expect(await screen.findByLabelText('Имя')).toHaveValue('Буся')
    await waitFor(async () => expect(await instance.get(CARD_CAT_KEY)).toBe('busya'))
    expect(
      within(screen.getByRole('group', { name: 'Разделы' })).getByRole('button', {
        name: 'Профиль',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('the last active cat: "В архив" is aria-disabled, explains itself and opens nothing', async () => {
    setup(ONE_CAT)
    const tab = await openAllTab()

    const archive = await tab.findByRole('button', { name: 'В архив' })
    expect(archive).toHaveAttribute('aria-disabled', 'true')
    const hint = tab.getByText(LAST_CAT_HINT)
    expect(archive).toHaveAttribute('aria-describedby', hint.id)
    expect(LAST_CAT_HINT).toBe(
      'Последнюю кошку в архив не убрать — на борде всегда есть кого показывать. Сначала добавьте другую.',
    )

    fireEvent.click(archive)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('"В архив" asks first, naming the fallback and an orphaned litter, then archives', async () => {
    const { calls } = setup()
    const tab = await openAllTab()
    const rows = within(await tab.findByRole('list', { name: 'Кошки на борде' }))

    fireEvent.click(
      within(rows.getAllByRole('listitem')[1]!).getByRole('button', { name: 'В архив' }),
    )

    const dialog = within(await screen.findByRole('dialog', { name: 'Убрать Бусю в архив?' }))
    expect(
      dialog.getByText(
        'Буся пропадёт из переключателей. Карточки, где была выбрана она, покажут Офелию. История кормлений, веса и лотка сохранится — вернуть можно во вкладке «Все кошки».',
      ),
    ).toBeInTheDocument()
    expect(
      dialog.getByText('Лоток · Буся больше никому не нужен: ночные отметки по нему остановятся.'),
    ).toBeInTheDocument()
    expect(calls.filter(({ action }) => action === 'archiveCat')).toEqual([])

    fireEvent.click(dialog.getByRole('button', { name: 'В архив' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ action: 'archiveCat', payload: { catId: 'busya' } }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('"Отмена" archives nothing', async () => {
    const { calls } = setup()
    const tab = await openAllTab()
    const rows = within(await tab.findByRole('list', { name: 'Кошки на борде' }))

    fireEvent.click(
      within(rows.getAllByRole('listitem')[1]!).getByRole('button', { name: 'В архив' }),
    )
    const dialog = within(await screen.findByRole('dialog', { name: 'Убрать Бусю в архив?' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Отмена' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(calls.filter(({ action }) => action === 'archiveCat')).toEqual([])
  })

  it('a refused archive stays open and says why', async () => {
    setup({
      ...TWO_CATS,
      invoke: async () => new ModuleApiError({ code: 'last_active_cat', reason: 'last' }),
    })
    const tab = await openAllTab()
    const rows = within(await tab.findByRole('list', { name: 'Кошки на борде' }))

    fireEvent.click(
      within(rows.getAllByRole('listitem')[1]!).getByRole('button', { name: 'В архив' }),
    )
    const dialog = within(await screen.findByRole('dialog', { name: 'Убрать Бусю в архив?' }))
    fireEvent.click(dialog.getByRole('button', { name: 'В архив' }))

    expect(await dialog.findByRole('alert')).toHaveTextContent('Последнюю кошку в архив не убрать')
  })

  it('archived cats are folded, dated, and come back with "Вернуть"', async () => {
    const { calls } = setup(ARCHIVED)
    const tab = await openAllTab()

    const summary = await tab.findByText('В архиве · 1')
    const details = summary.closest('details')
    expect(details).not.toHaveAttribute('open')
    expect(summary.tagName).toBe('SUMMARY')
    const row = within(tab.getByRole('list', { name: 'В архиве' })).getByRole('listitem')
    expect(row).toHaveTextContent('Буся')
    expect(row).toHaveTextContent('В архиве с 3 мая 2026 · история сохранена')

    fireEvent.click(within(row).getByRole('button', { name: 'Вернуть' }))
    await waitFor(() =>
      expect(calls).toContainEqual({ action: 'restoreCat', payload: { catId: 'busya' } }),
    )
  })

  it('"Добавить кошку" offers the litters, sends the cat, then chooses her and opens the profile', async () => {
    const { calls, instance } = setup()
    const tab = await openAllTab()

    fireEvent.click(await tab.findByRole('button', { name: 'Добавить кошку' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Новая кошка' }))
    expect(
      dialog.getByText(
        /Порода, вес, упитанность и цель — потом, в профиле\. Сразу после сохранения новая кошка появится в переключателе у всех кошачьих карточек\./,
      ),
    ).toBeInTheDocument()

    // A blank name is refused before anything is sent.
    fireEvent.click(dialog.getByRole('button', { name: 'Добавить кошку' }))
    expect(await dialog.findByText('Укажите имя')).toBeInTheDocument()
    expect(calls.filter(({ action }) => action === 'addCat')).toEqual([])

    fireEvent.change(dialog.getByLabelText('Имя'), { target: { value: 'Мурка' } })
    expect(await dialog.findByText(/Сразу после сохранения Мурка появится/)).toBeInTheDocument()
    const litters = within(dialog.getByRole('radiogroup', { name: 'Лоток' }))
    expect(litters.getAllByRole('radio').map((option) => option.textContent)).toEqual([
      expect.stringContaining('Общий с Офелией'),
      expect.stringContaining('Общий с Бусей'),
      expect.stringContaining('Свой лоток'),
    ])
    fireEvent.click(litters.getByRole('radio', { name: /Общий с Бусей/ }))
    fireEvent.click(dialog.getByRole('radio', { name: 'Кот' }))
    fireEvent.click(dialog.getByRole('button', { name: 'Добавить кошку' }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        action: 'addCat',
        payload: {
          name: 'Мурка',
          litter: { kind: 'existing', litterId: 'busya' },
          birthDate: null,
          sex: 'male',
        },
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(async () => expect(await instance.get(CARD_CAT_KEY)).toBe('new-cat'))
    expect(
      within(screen.getByRole('group', { name: 'Разделы' })).getByRole('button', {
        name: 'Профиль',
      }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
