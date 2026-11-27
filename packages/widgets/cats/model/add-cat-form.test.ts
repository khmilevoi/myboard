import { atom, context, wrap } from '@reatom/core'
import { defaultCatProfile, type CatProfile } from 'module-cats/domain/cat'
import type { CatRegistryEvent, LitterRegistryEvent } from 'module-cats/domain/registry'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleApiError } from 'widget-runtime'

import { makeAddCatForm } from './add-cat-form'
import { NEW_LITTER_VALUE } from './profile-form'

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

const OFELIA: CatProfile = defaultCatProfile('Офелия', 'ofelia')

const ONE_CAT: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('ofelia', 1)],
  litterRegistry: [litterEvent('ofelia', 1)],
  profiles: { ofelia: OFELIA },
}

afterEach(() => {
  context.reset()
})

function setup(options: MakeTestCatsModelOptions = {}, onAdded = vi.fn()) {
  const { model, calls } = makeTestCatsModel({
    ...ONE_CAT,
    todayIso: '2026-11-26',
    invoke: async (action) => (action === 'addCat' ? { ok: true, catId: 'new-cat' } : { ok: true }),
    ...options,
  })
  const form = makeAddCatForm(atom(model, 'test.cats'), { onAdded, name: 'test.addCat' })
  const off = form.litterOptions.subscribe(() => {})
  return { form, calls, onAdded, off }
}

describe('makeAddCatForm', () => {
  it('a blank name says "Укажите имя" and calls nothing', async () => {
    const { form, calls, onAdded, off } = setup()
    expect(form.issues()).toEqual({})

    const result = await wrap(() => form.submit())()

    expect(result).toBeUndefined()
    expect(form.issues()).toEqual({ name: 'Укажите имя' })
    expect(calls).toEqual([])
    expect(onAdded).not.toHaveBeenCalled()
    form.name.set('  ')
    expect(form.issues()).toEqual({ name: 'Укажите имя' })
    off()
  })

  it('"Буся" with the defaults records a new litter, no birth date and a female cat', async () => {
    const { form, calls, onAdded, off } = setup()
    form.name.set('Буся')

    const result = await wrap(() => form.submit())()

    expect(result).toEqual({ catId: 'new-cat' })
    expect(calls).toEqual([
      {
        action: 'addCat',
        payload: { name: 'Буся', litter: { kind: 'new' }, birthDate: null, sex: 'female' },
      },
    ])
    expect(onAdded).toHaveBeenCalledWith('new-cat')
    // Done with: the next "Новая кошка" starts empty.
    expect(form.name()).toBe('')
    off()
  })

  it('offers each litter as "Общий с …" plus a new one, which is the default', async () => {
    const { form, off } = setup()
    const read = wrap(() => form.litterOptions())
    await vi.waitFor(() => expect(read()).not.toBeNull())

    expect(read()).toEqual([
      {
        value: 'ofelia',
        choice: { kind: 'existing', litterId: 'ofelia' },
        title: 'Общий с Офелией',
        note: 'та же очередь',
        cats: [expect.objectContaining({ id: 'ofelia' })],
      },
      {
        value: NEW_LITTER_VALUE,
        choice: { kind: 'new' },
        title: 'Свой лоток',
        note: 'новая очередь',
        cats: [],
      },
    ])
    expect(form.litter()).toEqual({ kind: 'new' })
    off()
  })

  it('dismiss() forgets a refused submit and keeps the draft', async () => {
    const { form, off } = setup()
    form.birthDate.set('2026-03-15')
    await wrap(() => form.submit())()
    expect(form.issues()).toEqual({ name: 'Укажите имя' })

    form.dismiss()

    expect(form.issues()).toEqual({})
    expect(form.birthDate()).toBe('2026-03-15')
    off()
  })

  it('declines a litter-mate by her sex: "Общий с Рысью", "Общий с Игорем"', async () => {
    const { form, off } = setup({
      catRegistry: [catEvent('rys', 1), catEvent('igor', 2)],
      litterRegistry: [litterEvent('rys', 1), litterEvent('igor', 2)],
      profiles: {
        rys: { ...defaultCatProfile('Рысь', 'rys'), sex: 'female' },
        igor: { ...defaultCatProfile('Игорь', 'igor'), sex: 'male' },
      },
    })
    const read = wrap(() => form.litterOptions()?.map((option) => option.title))
    await vi.waitFor(() => expect(read()).not.toBeUndefined())

    expect(read()).toEqual(['Общий с Рысью', 'Общий с Игорем', 'Свой лоток'])
    off()
  })

  it('bounds the birth date by today', () => {
    const { form, off } = setup()
    expect(wrap(() => form.maxBirthDate()?.toString())()).toBe('2026-11-26')
    off()
  })

  it('sends a chosen litter, a birth date and the sex', async () => {
    const { form, calls, off } = setup()
    form.name.set('Буся')
    form.birthDate.set('2026-03-15')
    form.sex.set('male')
    form.litter.set({ kind: 'existing', litterId: 'ofelia' })

    await wrap(() => form.submit())()

    expect(calls[0]?.payload).toEqual({
      name: 'Буся',
      litter: { kind: 'existing', litterId: 'ofelia' },
      birthDate: '2026-03-15',
      sex: 'male',
    })
    off()
  })

  it('a failed add returns the error, keeps the form and says so', async () => {
    const failure = new ModuleApiError({ code: 'boom', reason: 'boom' })
    const { form, onAdded, off } = setup({ invoke: async () => failure })
    form.name.set('Буся')

    expect(await wrap(() => form.submit())()).toBe(failure)

    expect(form.name()).toBe('Буся')
    expect(form.failed()).toBe(true)
    expect(onAdded).not.toHaveBeenCalled()
    form.name.set('Буся!')
    expect(form.failed()).toBe(false)
    off()
  })
})
