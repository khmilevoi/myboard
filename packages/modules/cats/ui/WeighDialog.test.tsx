import { atom, computed, context } from '@reatom/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { defaultCatProfile, type Weighing } from '../domain/cat'
import { catWeightKey } from '../domain/keys'
import { makeTestCatsModel } from '../model/testing'
import { makeWeighForm } from '../model/weigh-form'
import { WeighDialog } from './WeighDialog'

// Unmount first: a component unmounting after the reset touches a dead root.
afterEach(() => {
  cleanup()
  context.reset()
})

function renderDialog(weighings?: Weighing[]) {
  const storage = createFakeStorage()
  // The fake's `set` writes synchronously before its first await.
  if (weighings) void storage.set(catWeightKey('ofelia'), weighings)
  const { model, calls } = makeTestCatsModel({
    storage,
    todayIso: '2026-11-26',
    profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') },
  })
  const form = makeWeighForm(
    atom(model.cat('ofelia'), 'test.cat'),
    computed(() => model.today(), 'test.today'),
  )
  const onOpenChange = vi.fn()
  render(<WeighDialog form={form} name="Офелия" open onOpenChange={onOpenChange} />)
  return { calls, onOpenChange }
}

describe('WeighDialog', () => {
  it('titles the sheet with the cat and lays out the fields', async () => {
    renderDialog()

    expect(await screen.findByRole('dialog', { name: 'Вес · Офелия' })).toBeInTheDocument()
    expect(screen.getByLabelText('Сколько весит')).toHaveAttribute('inputmode', 'decimal')
    expect(
      screen.getByText('Удобно: взвеситься с кошкой на руках и вычесть свой вес.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Дата')).toHaveValue('2026-11-26')
    expect(screen.getByText('По умолчанию сегодня')).toBeInTheDocument()
  })

  it('saves 4,30 kg on today and closes', async () => {
    const { calls, onOpenChange } = renderDialog()

    fireEvent.change(await screen.findByLabelText('Сколько весит'), {
      target: { value: '4,30' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить вес' }))

    await waitFor(() =>
      expect(calls).toEqual([
        { action: 'weigh', payload: { catId: 'ofelia', kg: 4.3, at: '2026-11-26' } },
      ]),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows the range error under the input and disables saving for 31', async () => {
    const { calls } = renderDialog()
    const input = await screen.findByLabelText('Сколько весит')

    fireEvent.change(input, { target: { value: '31' } })

    const message = await screen.findByText('Введите вес от 0,01 до 30 кг')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', message.id)
    const save = screen.getByRole('button', { name: 'Сохранить вес' })
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(calls).toEqual([])
  })

  it('shows the last weighing and the change the typed weight makes', async () => {
    renderDialog([{ id: 'w1', ts: 1, at: '2026-11-21', kg: 4.32 }])

    const previous = await screen.findByText(/Прошлый раз/)
    expect(previous).toHaveTextContent('Прошлый раз 4,32 кг, 21 ноября')

    fireEvent.change(screen.getByLabelText('Сколько весит'), { target: { value: '4,30' } })

    await waitFor(() =>
      expect(previous).toHaveTextContent('Прошлый раз 4,32 кг, 21 ноября — −20 г'),
    )
  })
})
