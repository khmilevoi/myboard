// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { defaultCatProfile, type CatProfile } from 'module-cats/domain/cat'
import { catGoalKey, catWeightKey } from 'module-cats/domain/keys'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  makeFileSlotFromApi,
  WidgetRuntimeContext,
  type WidgetModules,
  type WidgetRuntimeProps,
} from 'widget-runtime'
import {
  createFakeStorage,
  makeFakeFileSlotApi,
  makeFakeFileSlots,
} from 'widget-runtime/storage/test/fakes'

import { Cats } from '../Cats'

const TODAY = '2026-11-26'

const OFELIA: CatProfile = {
  ...defaultCatProfile('Офелия', 'ofelia'),
  breed: 'Британская короткошёрстная',
  birthDate: '2023-09-12',
  sex: 'female',
  sterilized: 'yes',
  bodyCondition: 5,
}
const BUSYA: CatProfile = { ...defaultCatProfile('Буся', 'busya'), breed: 'Беспородная' }

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

let nextInstance = 1

function setup(
  options: MakeTestCatsModelOptions = ONE_CAT,
  overrides: Partial<WidgetRuntimeProps> = {},
) {
  const shared = createFakeStorage()
  void shared.set(catWeightKey('ofelia'), [
    { id: 'w1', ts: 1, at: '2026-11-21', kg: 4.32, createdBy: { accountId: 'a', name: 'Леша' } },
  ])
  void shared.set(catGoalKey('ofelia'), [
    { id: 'g1', ts: 1, kcal: 250, since: '2026-09-01' },
    { id: 'g2', ts: 2, kcal: 240, since: '2026-11-01' },
  ])
  const { model, calls } = makeTestCatsModel({ todayIso: TODAY, storage: shared, ...options })
  const instance = createFakeStorage()
  const props: WidgetRuntimeProps = {
    instanceId: `cats-full-${nextInstance++}`,
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
  return { props, calls }
}

afterEach(() => {
  cleanup()
  context.reset()
})

const tabs = () => within(screen.getByRole('group', { name: 'Разделы' }))

describe('FullscreenTier', () => {
  it('the header: name, breed and age, the tabs and only "Закрыть"', async () => {
    const { props } = setup()

    expect(await screen.findByRole('heading', { name: 'Офелия' })).toBeInTheDocument()
    expect(screen.getByText('Британская короткошёрстная · 3 года 2 мес')).toBeInTheDocument()
    expect(tabs().getByRole('button', { name: 'Профиль' })).toHaveAttribute('aria-pressed', 'true')
    // One cat: no switcher.
    expect(screen.queryByRole('button', { name: /^Выбрать кошку/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(props.requestClose).toHaveBeenCalledOnce()
  })

  it('the large board tier: the same view with "Развернуть" and "Удалить"', async () => {
    setup(ONE_CAT, { mode: 'small', tier: 'large' })

    expect(await screen.findByRole('heading', { name: 'Офелия' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Развернуть' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument()
    expect(screen.getByLabelText('Имя')).toHaveValue('Офелия')
  })

  it('two cats: the header has the switcher', async () => {
    setup(TWO_CATS)
    await screen.findByRole('heading', { name: 'Офелия' })
    expect(screen.getByRole('button', { name: /^Выбрать кошку/ })).toBeInTheDocument()
  })

  it('the tabs switch the panel', async () => {
    setup()
    expect(await screen.findByLabelText('Имя')).toHaveValue('Офелия')

    fireEvent.click(tabs().getByRole('button', { name: 'Вес' }))
    expect(await screen.findByRole('region', { name: 'Вес' })).toBeInTheDocument()
    expect(tabs().getByRole('button', { name: 'Вес' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByLabelText('Имя')).not.toBeInTheDocument()

    fireEvent.click(tabs().getByRole('button', { name: 'Все кошки' }))
    expect(await screen.findByRole('region', { name: 'Все кошки' })).toBeInTheDocument()

    fireEvent.click(tabs().getByRole('button', { name: 'Профиль' }))
    expect(await screen.findByLabelText('Имя')).toHaveValue('Офелия')
  })

  it('"Сохранить" is disabled until a field changes, then saves the profile', async () => {
    const { calls } = setup()
    const breed = await screen.findByLabelText('Порода')

    expect(screen.getByText('Все изменения сохранены')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отменить' })).toBeDisabled()

    fireEvent.change(breed, { target: { value: 'Сибирская' } })
    expect(
      await screen.findByText('Изменения не сохранены · цель сохраняется отдельно'),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Сохранить' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        action: 'saveProfile',
        payload: {
          catId: 'ofelia',
          profile: expect.objectContaining({ breed: 'Сибирская', name: 'Офелия' }),
          litter: { kind: 'existing', litterId: 'ofelia' },
        },
      }),
    )
  })

  it('"Отменить" brings the profile back; an empty name says "Укажите имя"', async () => {
    setup()
    const name = await screen.findByLabelText('Имя')

    fireEvent.change(name, { target: { value: '' } })
    expect(await screen.findByText('Укажите имя')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: 'Сохранить' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }))
    await waitFor(() => expect(screen.getByLabelText('Имя')).toHaveValue('Офелия'))
    expect(screen.queryByText('Укажите имя')).not.toBeInTheDocument()
  })

  it('the fields: sex, sterilized, body condition with its hint, the litter choice', async () => {
    const { calls } = setup(TWO_CATS)
    await screen.findByLabelText('Имя')

    expect(screen.getByLabelText('Дата рождения')).toHaveAttribute('max', TODAY)
    expect(screen.getByRole('radio', { name: 'Кошка' })).toHaveAttribute('aria-checked', 'true')
    expect(
      within(screen.getByRole('radiogroup', { name: 'Стерилизована' })).getByRole('radio', {
        name: 'Да',
      }),
    ).toHaveAttribute('aria-checked', 'true')
    expect(
      screen.getByText('5 — идеал: рёбра прощупываются, талия видна сверху.'),
    ).toBeInTheDocument()
    expect(screen.getByText('3 года 2 мес')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: '6' }))
    await waitFor(() =>
      expect(
        screen.queryByText('5 — идеал: рёбра прощупываются, талия видна сверху.'),
      ).not.toBeInTheDocument(),
    )

    const litter = within(screen.getByRole('radiogroup', { name: 'Лоток' }))
    expect(litter.getByRole('radio', { name: /Лоток · Офелия/ })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    fireEvent.click(litter.getByRole('radio', { name: /Новый лоток/ }))
    await waitFor(() =>
      expect(litter.getByRole('radio', { name: /Новый лоток/ })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }))

    await waitFor(() =>
      expect(calls).toContainEqual({
        action: 'saveProfile',
        payload: {
          catId: 'ofelia',
          profile: expect.objectContaining({ bodyCondition: 6 }),
          litter: { kind: 'new' },
        },
      }),
    )
  })

  it('the goal: in force since, the hint with "Взять", the earlier goal', async () => {
    const { calls } = setup()

    expect(await screen.findByText('ккал в сутки · с 1 ноября')).toBeInTheDocument()
    expect(
      screen.getByText(
        'Раньше 250 ккал. Прошлые дни считаются по своей цели. Цель видна в «миске дня» в питании.',
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/Ориентир по весу 4,32 кг —/)).toHaveTextContent(
      'Ориентир по весу 4,32 кг — ≈ 252 ккал',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Взять' }))
    await waitFor(() =>
      expect(calls).toContainEqual({
        action: 'setGoal',
        payload: { catId: 'ofelia', kcal: 252, since: TODAY },
      }),
    )

    fireEvent.change(screen.getByLabelText('Своя цель'), { target: { value: '40' } })
    expect(await screen.findByText('От 50 до 1000 ккал')).toBeInTheDocument()
  })

  it('a kitten: the hint is left to a vet', async () => {
    setup({ ...ONE_CAT, profiles: { ofelia: { ...OFELIA, birthDate: '2026-05-01' } } })

    expect(
      await screen.findByText('Для этой кошки ориентир подбирает ветеринар'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Котёнок до года, кошка старше 10 лет или упитанность не 4–5.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Взять' })).not.toBeInTheDocument()
  })

  it('no age yet: the hint waits for the data', async () => {
    setup({ ...ONE_CAT, profiles: { ofelia: { ...OFELIA, birthDate: null } } })

    expect(
      await screen.findByText('Ориентир появится, когда будут вес, возраст и стерилизация'),
    ).toBeInTheDocument()
  })

  it('the photo: without one the caption; with one "Заменить фото" and "Убрать фото"', async () => {
    setup()
    expect(await screen.findByText('Без фото — буква на цвете кошки')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Загрузить фото' })).toBeEnabled()
    cleanup()
    context.reset()

    const ref = {
      blobId: 'abcdefghijklmnop',
      url: '/files/abcdefghijklmnop',
      mime: 'image/webp',
      size: 10,
      updatedAt: 1,
    }
    const slot = makeFileSlotFromApi(makeFakeFileSlotApi(ref), 'test.avatar')
    setup({ ...ONE_CAT, files: () => slot })
    expect(await screen.findByRole('button', { name: 'Заменить фото' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать фото' })).toBeInTheDocument()
    expect(screen.queryByText('Без фото — буква на цвете кошки')).not.toBeInTheDocument()
  })

  it('"Взвесить" on the Вес tab opens the weigh dialog', async () => {
    setup()
    await screen.findByLabelText('Имя')

    fireEvent.click(tabs().getByRole('button', { name: 'Вес' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Взвесить' }))
    expect(await screen.findByRole('dialog', { name: 'Вес · Офелия' })).toBeInTheDocument()
  })
})
