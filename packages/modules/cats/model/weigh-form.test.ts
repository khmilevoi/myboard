import { atom, computed, context, wrap, type AtomLike } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleApiError } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { defaultCatProfile, type Weighing } from '../domain/cat'
import { catWeightKey } from '../domain/keys'
import { makeTestCatsModel, type MakeTestCatsModelOptions } from './testing'
import { WEIGHT_INPUT_ERROR, makeWeighForm, parseDateInput, parseKg } from './weigh-form'

const D = (iso: string) => Temporal.PlainDate.from(iso)

afterEach(() => {
  context.reset()
})

const VALID = ['4,30', '4.3', ' 4,3 ']
const INVALID = ['', '0', '31', '4,3,1', 'abc']

describe('parseKg', () => {
  it.each(VALID)('accepts %j as 4.3', (text) => {
    expect(parseKg(text)).toBe(4.3)
  })

  it.each(INVALID)('rejects %j', (text) => {
    expect(parseKg(text)).toBeNull()
  })

  it('accepts the bounds and refuses a third decimal', () => {
    expect(parseKg('0,01')).toBe(0.01)
    expect(parseKg('30')).toBe(30)
    expect(parseKg('30,01')).toBeNull()
    expect(parseKg('4,305')).toBeNull()
    expect(parseKg('-4')).toBeNull()
  })
})

describe('parseDateInput', () => {
  it('reads a date input value and refuses a cleared or impossible one', () => {
    expect(parseDateInput('2026-11-24')?.toString()).toBe('2026-11-24')
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('2026-02-30')).toBeNull()
  })
})

const LATEST: Weighing[] = [
  { id: 'w1', ts: 1, at: '2026-11-07', kg: 4.4 },
  { id: 'w2', ts: 2, at: '2026-11-21', kg: 4.32 },
]

function setup(
  options: {
    weighings?: Weighing[]
    invoke?: MakeTestCatsModelOptions['invoke']
    /** Replaces the fake clock's day, so a test can roll it over. */
    today?: AtomLike<Temporal.PlainDate | null>
  } = {},
) {
  const storage = createFakeStorage()
  // The fake's `set` writes synchronously before its first await.
  if (options.weighings) void storage.set(catWeightKey('ofelia'), options.weighings)
  const { model, calls } = makeTestCatsModel({
    storage,
    todayIso: '2026-11-26',
    profiles: { ofelia: defaultCatProfile('Офелия', 'ofelia') },
    invoke: options.invoke,
  })
  const cat = atom(model.cat('ofelia'), 'test.cat')
  const today = options.today ?? computed(() => model.today(), 'test.today')
  const form = makeWeighForm(cat, today)
  const weighCalls = () => calls.filter((call) => call.action === 'weigh')
  return { form, calls, weighCalls }
}

describe('makeWeighForm', () => {
  it('shows no error on a fresh, empty form', () => {
    const { form } = setup()
    expect(form.text()).toBe('')
    expect(form.error()).toBeNull()
  })

  it.each(INVALID)('shows the range error for %j on submit and sends nothing', async (text) => {
    const { form, weighCalls } = setup()

    form.text.set(text)
    const result = await wrap(() => form.submit())()

    expect(result).toBeUndefined()
    expect(form.error()).toBe('Введите вес от 0,01 до 30 кг')
    expect(WEIGHT_INPUT_ERROR).toBe('Введите вес от 0,01 до 30 кг')
    expect(weighCalls()).toEqual([])
  })

  it('shows the error while a non-empty text is invalid, before any submit', () => {
    const { form } = setup()
    form.text.set('31')
    expect(form.error()).toBe('Введите вес от 0,01 до 30 кг')
    form.text.set('4,3')
    expect(form.error()).toBeNull()
  })

  it.each(VALID)('sends %j as 4.3 kg on today and resets the form', async (text) => {
    const { form, weighCalls } = setup()

    form.text.set(text)
    const result = await wrap(() => form.submit())()

    expect(result).toBeUndefined()
    expect(weighCalls()).toEqual([
      { action: 'weigh', payload: { catId: 'ofelia', kg: 4.3, at: '2026-11-26' } },
    ])
    expect(form.text()).toBe('')
    expect(form.error()).toBeNull()
  })

  it('defaults the date to today and sends a date the user picked', async () => {
    const { form, weighCalls } = setup()
    expect(form.date()?.toString()).toBe('2026-11-26')

    form.pickDate(D('2026-11-24'))
    form.text.set('4,31')
    await wrap(() => form.submit())()

    expect(weighCalls()).toEqual([
      { action: 'weigh', payload: { catId: 'ofelia', kg: 4.31, at: '2026-11-24' } },
    ])
    expect(form.date()?.toString()).toBe('2026-11-26')
  })

  it('follows today across midnight until the user picks a day, then keeps that day', async () => {
    const today = atom<Temporal.PlainDate | null>(D('2026-11-26'), 'test.clock')
    const { form, weighCalls } = setup({ today })

    today.set(D('2026-11-27'))
    expect(form.date()?.toString()).toBe('2026-11-27')

    form.pickDate(D('2026-11-25'))
    today.set(D('2026-11-28'))
    expect(form.date()?.toString()).toBe('2026-11-25')

    form.text.set('4,3')
    await wrap(() => form.submit())()
    expect(weighCalls()).toEqual([
      { action: 'weigh', payload: { catId: 'ofelia', kg: 4.3, at: '2026-11-25' } },
    ])

    // A saved weighing hands the date back to the clock.
    expect(form.date()?.toString()).toBe('2026-11-28')
    today.set(D('2026-11-29'))
    expect(form.date()?.toString()).toBe('2026-11-29')
  })

  it('sends nothing without a date', async () => {
    const { form, weighCalls } = setup()
    form.text.set('4,3')
    expect(form.canSend()).toBe(true)
    form.pickDate(null)
    expect(form.canSend()).toBe(false)

    await wrap(() => form.submit())()

    expect(weighCalls()).toEqual([])
    expect(form.text()).toBe('4,3')
  })

  it('keeps the text and reports a failed save', async () => {
    const failure = new ModuleApiError({ reason: 'offline', code: 'network' })
    const { form } = setup({ invoke: async () => failure })

    form.text.set('4,3')
    const result = await wrap(() => form.submit())()

    expect(result).toBe(failure)
    expect(form.text()).toBe('4,3')
    expect(form.failure()).toBe('Не удалось сохранить вес')
    form.text.set('4,31')
    expect(form.failure()).toBeNull()
  })

  it('shows the latest weighing and the delta of the typed weight', async () => {
    const { form } = setup({ weighings: LATEST })

    await context.start(async () => {
      const off = form.previous.subscribe(() => {})
      const read = wrap(() => form.previous())
      const setText = wrap((text: string) => form.text.set(text))

      await vi.waitFor(() => expect(read()?.kg).toBe(4.32))
      expect(read()?.at.toString()).toBe('2026-11-21')
      expect(read()?.deltaGrams).toBeNull()

      setText('4,30')
      expect(read()?.deltaGrams).toBe(-20)

      setText('abc')
      expect(read()?.deltaGrams).toBeNull()
      off()
    })
  })

  it('has no previous weighing for a cat never weighed', async () => {
    const { form } = setup({ weighings: [] })

    await context.start(async () => {
      const off = form.previous.subscribe(() => {})
      const read = wrap(() => form.previous())
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(read()).toBeNull()
      off()
    })
  })
})
