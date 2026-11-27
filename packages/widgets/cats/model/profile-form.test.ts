import { atom, context, wrap } from '@reatom/core'
import { defaultCatProfile, type CatProfile } from 'module-cats/domain/cat'
import { catProfileKey, litterSettingsKey } from 'module-cats/domain/keys'
import type { CatRegistryEvent, LitterRegistryEvent } from 'module-cats/domain/registry'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { makeProfileForm, NAME_ISSUE, NEW_LITTER_VALUE } from './profile-form'

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
  birthDate: '2023-09-12',
  sex: 'female',
  sterilized: 'yes',
  bodyCondition: 5,
}
const BUSYA: CatProfile = { ...defaultCatProfile('Буся', 'busya'), breed: 'Беспородная' }

const TWO_CATS: MakeTestCatsModelOptions = {
  catRegistry: [catEvent('ofelia', 1), catEvent('busya', 2)],
  litterRegistry: [litterEvent('ofelia', 1), litterEvent('busya', 2)],
  profiles: { ofelia: OFELIA, busya: BUSYA },
}

afterEach(() => {
  context.reset()
})

function setup(options: MakeTestCatsModelOptions = TWO_CATS) {
  const shared = options.storage ?? createFakeStorage()
  void shared.set(litterSettingsKey('ofelia'), { rotation: ['Леша', 'Карина'] })
  const { model, calls } = makeTestCatsModel({
    todayIso: '2026-11-26',
    storage: shared,
    ...options,
  })
  const cats = atom(model, 'test.cats')
  const cat = atom(model.cat('ofelia'), 'test.cat')
  const form = makeProfileForm({ cat, model: cats, name: 'test.profile' })
  // The form's computeds stay connected for the whole test, as a mounted tab keeps them.
  const offs = [form.draft, form.dirty, form.litterOptions].map((unit) => unit.subscribe(() => {}))
  return { form, calls, shared, cat, model, off: () => offs.forEach((off) => off()) }
}

async function loaded(form: ReturnType<typeof setup>['form']) {
  const draft = wrap(() => form.draft())
  await vi.waitFor(() => expect(draft()).not.toBeNull())
}

describe('makeProfileForm', () => {
  it('copies the profile once it loads, clean', async () => {
    const { form, off } = setup()
    await loaded(form)
    expect(form.draft()?.name).toBe('Офелия')
    expect(form.litter()).toEqual({ kind: 'existing', litterId: 'ofelia' })
    expect(form.dirty()).toBe(false)
    off()
  })

  it('editing the name makes it dirty; reset brings the profile back', async () => {
    const { form, off } = setup()
    await loaded(form)
    form.edit({ name: 'Офи' })
    expect(form.draft()?.name).toBe('Офи')
    expect(form.dirty()).toBe(true)

    form.reset()
    expect(form.draft()?.name).toBe('Офелия')
    expect(form.dirty()).toBe(false)
    off()
  })

  it('a live profile update while dirty leaves the draft alone, and Сохранить sends the draft', async () => {
    const { form, calls, shared, cat, off } = setup()
    await loaded(form)
    form.edit({ breed: 'Сибирская' })

    // Another device saves the profile, and the cat's profile has it.
    await shared.set(catProfileKey('ofelia'), { ...OFELIA, name: 'Офелия Петровна' })
    const liveName = wrap(() => cat().profile()?.name)
    await vi.waitFor(() => expect(liveName()).toBe('Офелия Петровна'))
    expect(form.dirty()).toBe(true)
    expect(form.draft()).toMatchObject({ name: 'Офелия', breed: 'Сибирская' })

    await form.save()
    expect(calls).toContainEqual({
      action: 'saveProfile',
      payload: {
        catId: 'ofelia',
        profile: expect.objectContaining({ name: 'Офелия', breed: 'Сибирская' }),
        litter: { kind: 'existing', litterId: 'ofelia' },
      },
    })
    expect(form.dirty()).toBe(false)
    off()
  })

  it('a live profile update while clean updates the draft', async () => {
    const { form, shared, off } = setup()
    await loaded(form)

    await shared.set(catProfileKey('ofelia'), { ...OFELIA, breed: 'Сибирская' })
    await vi.waitFor(() => expect(form.draft()?.breed).toBe('Сибирская'))
    expect(form.dirty()).toBe(false)
    off()
  })

  it('save sends the draft with the litter the cat already uses as existing', async () => {
    const { form, calls, off } = setup()
    await loaded(form)
    form.edit({ bodyCondition: 6 })

    const result = await form.save()
    expect(result).toBeUndefined()
    const { litterId: _litterId, ...fields } = { ...OFELIA, bodyCondition: 6 }
    expect(calls).toContainEqual({
      action: 'saveProfile',
      payload: {
        catId: 'ofelia',
        profile: fields,
        litter: { kind: 'existing', litterId: 'ofelia' },
      },
    })
    off()
  })

  it('choosing another litter or a new one is dirty and is sent as chosen', async () => {
    const { form, calls, off } = setup()
    await loaded(form)

    form.chooseLitter({ kind: 'existing', litterId: 'busya' })
    expect(form.dirty()).toBe(true)
    form.chooseLitter({ kind: 'existing', litterId: 'ofelia' })
    expect(form.dirty()).toBe(false)

    form.chooseLitter({ kind: 'new' })
    await form.save()
    expect(calls.at(-1)).toMatchObject({
      action: 'saveProfile',
      payload: { litter: { kind: 'new' } },
    })
    off()
  })

  // The server writes the profile before it answers, so its echo can come first.
  it('a saved "Новый лоток" whose echo came before the answer is never sent again', async () => {
    const shared = createFakeStorage()
    const { form, calls, off } = setup({
      ...TWO_CATS,
      storage: shared,
      invoke: async (action) => {
        if (action === 'saveProfile')
          await shared.set(catProfileKey('ofelia'), { ...OFELIA, litterId: 'ofelia-2' })
        return { ok: true }
      },
    })
    await loaded(form)

    form.chooseLitter({ kind: 'new' })
    await form.save()
    expect(form.dirty()).toBe(false)
    expect(form.litter()).toEqual({ kind: 'existing', litterId: 'ofelia-2' })

    form.edit({ name: 'Офи' })
    await form.save()
    const saves = calls.filter((call) => call.action === 'saveProfile')
    expect(saves).toHaveLength(2)
    expect(saves[1]?.payload).toMatchObject({ litter: { kind: 'existing', litterId: 'ofelia-2' } })
    off()
  })

  it('an edit between the answer and the echo of "Новый лоток" sends the new litter, not a new one', async () => {
    const { form, calls, shared, cat, off } = setup()
    await loaded(form)

    form.chooseLitter({ kind: 'new' })
    await form.save()
    form.edit({ name: 'Офи' })
    expect(form.dirty()).toBe(true)

    await shared.set(catProfileKey('ofelia'), { ...OFELIA, litterId: 'ofelia-2' })
    const liveLitter = wrap(() => cat().profile()?.litterId)
    await vi.waitFor(() => expect(liveLitter()).toBe('ofelia-2'))

    await form.save()
    const saves = calls.filter((call) => call.action === 'saveProfile')
    expect(saves).toHaveLength(2)
    expect(saves[0]?.payload).toMatchObject({ litter: { kind: 'new' } })
    expect(saves[1]?.payload).toMatchObject({
      profile: expect.objectContaining({ name: 'Офи' }),
      litter: { kind: 'existing', litterId: 'ofelia-2' },
    })
    off()
  })

  it('a save whose echo came before the answer does not stay held', async () => {
    const shared = createFakeStorage()
    const { form, off } = setup({
      ...TWO_CATS,
      storage: shared,
      invoke: async (action, payload) => {
        if (action === 'saveProfile') {
          const { profile } = payload as { profile: object }
          await shared.set(catProfileKey('ofelia'), { ...profile, litterId: 'ofelia' })
        }
        return { ok: true }
      },
    })
    await loaded(form)

    form.edit({ breed: 'Сибирская' })
    await form.save()
    expect(form.dirty()).toBe(false)

    // A later change from another device shows at once: nothing holds the draft any more.
    await shared.set(catProfileKey('ofelia'), { ...OFELIA, breed: 'Мейн-кун' })
    const breed = wrap(() => form.draft()?.breed)
    await vi.waitFor(() => expect(breed()).toBe('Мейн-кун'))
    off()
  })

  it('offers each litter with its rotation, then "+ Новый лоток"', async () => {
    const { form, off } = setup()
    await loaded(form)
    await vi.waitFor(() =>
      expect(form.litterOptions()?.map((option) => option.note)).toEqual([
        'Леша и Карина',
        'Леша и Карина',
        'своя очередь',
      ]),
    )
    expect(form.litterOptions()?.map((option) => [option.value, option.title])).toEqual([
      ['ofelia', 'Лоток · Офелия'],
      ['busya', 'Лоток · Буся'],
      [NEW_LITTER_VALUE, 'Новый лоток'],
    ])
    expect(form.litterOptions()?.[2]?.choice).toEqual({ kind: 'new' })
    off()
  })

  it('an empty name is an issue, and save sends nothing', async () => {
    const { form, calls, off } = setup()
    await loaded(form)
    form.edit({ name: '  ' })

    expect(form.issues().name).toBe(NAME_ISSUE)
    expect(NAME_ISSUE).toBe('Укажите имя')
    await form.save()
    expect(calls.filter((call) => call.action === 'saveProfile')).toEqual([])
    expect(form.dirty()).toBe(true)
    off()
  })

  it('a failed save keeps the draft dirty and returns the error', async () => {
    const { form, off } = setup({
      ...TWO_CATS,
      invoke: async () => new Error('down'),
    })
    await loaded(form)
    form.edit({ name: 'Офи' })

    const result = await form.save()
    expect(result).toBeInstanceOf(Error)
    expect(form.dirty()).toBe(true)
    expect(form.draft()?.name).toBe('Офи')
    off()
  })

  it('switching the cat drops the draft of the other one', async () => {
    const { form, cat, model, off } = setup()
    await loaded(form)
    form.edit({ name: 'Офи' })

    cat.set(model.cat('busya'))
    await vi.waitFor(() => expect(form.draft()?.name).toBe('Буся'))
    expect(form.dirty()).toBe(false)

    cat.set(model.cat('ofelia'))
    await vi.waitFor(() => expect(form.draft()?.name).toBe('Офелия'))
    off()
  })
})
