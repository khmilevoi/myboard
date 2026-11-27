// @vitest-environment jsdom
import { context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { defaultCatProfile, type CatProfile } from 'module-cats/domain/cat'
import { catGoalKey, catWeightKey } from 'module-cats/domain/keys'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  WidgetRuntimeContext,
  type WidgetModules,
  type WidgetRuntimeProps,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'

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

const WEIGHINGS = [
  { at: '2026-09-15', kg: 4.42, createdBy: { accountId: 'a', name: 'Леша' } },
  { at: '2026-10-01', kg: 4.4, createdBy: { accountId: 'k', name: 'Карина' } },
  { at: '2026-10-14', kg: 4.41, createdBy: { accountId: 'a', name: 'Леша' } },
  { at: '2026-10-27', kg: 4.38, createdBy: { accountId: 'a', name: 'Леша' } },
  { at: '2026-11-07', kg: 4.35, createdBy: { accountId: 'k', name: 'Карина' } },
  { at: '2026-11-21', kg: 4.32, createdBy: { accountId: 'a', name: 'Леша' } },
].map((weighing, index) => ({ id: `w${index}`, ts: index + 1, ...weighing }))

const ONE_CAT: MakeTestCatsModelOptions = {
  catRegistry: [{ id: 'c1', ts: 1, catId: 'ofelia', op: 'add' }],
  litterRegistry: [{ id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' }],
  profiles: { ofelia: OFELIA },
}
let nextInstance = 1

function setup(
  weighings: unknown[] = WEIGHINGS,
  options: MakeTestCatsModelOptions = ONE_CAT,
  overrides: Partial<WidgetRuntimeProps> = {},
) {
  const shared = createFakeStorage()
  void shared.set(catWeightKey('ofelia'), weighings)
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

async function openWeightTab() {
  const tabs = within(await screen.findByRole('group', { name: 'Разделы' }))
  fireEvent.click(tabs.getByRole('button', { name: 'Вес' }))
  return await screen.findByRole('region', { name: 'Вес' })
}

describe('WeightTab', () => {
  it('the rows: date, kg and the delta to the next older weighing, newest first', async () => {
    setup()
    const region = within(await openWeightTab())
    const rows = region.getAllByRole('listitem')

    expect(rows).toHaveLength(6)
    expect(rows[0]).toHaveTextContent('21 ноя')
    expect(rows[0]).toHaveTextContent('4,32')
    expect(rows[0]).toHaveTextContent('−30 г')
    expect(rows[3]).toHaveTextContent('+10 г')
    expect(rows[5]).toHaveTextContent('15 сен')
    expect(rows[5]).not.toHaveTextContent('г')
    expect(within(rows[0]).getByTitle('Леша')).toBeInTheDocument()
    expect(within(rows[1]).getByTitle('Карина')).toBeInTheDocument()
    expect(
      region.getByText(
        'Взвешивания пишутся и отсюда, и кнопкой «Вес» в питании — это одна история.',
      ),
    ).toBeInTheDocument()
  })

  it('the range buttons toggle aria-pressed; the quarter is the default', async () => {
    setup()
    const region = within(await openWeightTab())
    const group = within(region.getByRole('toolbar', { name: 'Период' }))
    const month = group.getByRole('button', { name: 'Месяц' })
    const quarter = group.getByRole('button', { name: '3 месяца' })

    expect(quarter).toHaveAttribute('aria-pressed', 'true')
    expect(month).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(month)
    await waitFor(() => expect(month).toHaveAttribute('aria-pressed', 'true'))
    expect(quarter).toHaveAttribute('aria-pressed', 'false')

    // Pressing the chosen range keeps it chosen.
    fireEvent.click(month)
    expect(month).toHaveAttribute('aria-pressed', 'true')
    // The list still holds every weighing.
    expect(region.getAllByRole('listitem')).toHaveLength(6)
  })

  it('the chart summary reads the latest weight and the month trend', async () => {
    setup()
    const region = await openWeightTab()
    expect(within(region).getByText('4,32 кг, −90 г за месяц')).toBeInTheDocument()
  })

  it('no weighings: the empty state with "Взвесить", which opens the weigh form', async () => {
    setup([])
    const region = within(await openWeightTab())

    expect(region.getByText('Взвешиваний пока нет')).toBeInTheDocument()
    fireEvent.click(region.getByRole('button', { name: 'Взвесить' }))
    expect(await screen.findByRole('dialog', { name: 'Вес · Офелия' })).toBeInTheDocument()
  })

  it('"Взвесить" opens the same weigh form', async () => {
    setup()
    const region = within(await openWeightTab())
    fireEvent.click(region.getByRole('button', { name: 'Взвесить' }))
    expect(await screen.findByRole('dialog', { name: 'Вес · Офелия' })).toBeInTheDocument()
  })
})
