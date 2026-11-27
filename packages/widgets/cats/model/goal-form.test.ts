import { atom, context, wrap } from '@reatom/core'
import { defaultCatProfile, type CatProfile, type GoalEntry } from 'module-cats/domain/cat'
import { catGoalKey, catWeightKey } from 'module-cats/domain/keys'
import { makeTestCatsModel } from 'module-cats/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { GOAL_INPUT_ERROR, makeGoalForm } from './goal-form'

const TODAY = '2026-11-26'

const ADULT: CatProfile = {
  ...defaultCatProfile('Офелия', 'ofelia'),
  birthDate: '2023-09-12',
  sex: 'female',
  sterilized: 'yes',
  bodyCondition: 5,
}

const GOALS: GoalEntry[] = [
  { id: 'g1', ts: 1, kcal: 250, since: '2026-09-01' },
  { id: 'g2', ts: 2, kcal: 240, since: '2026-11-01' },
]

afterEach(() => {
  context.reset()
})

function setup(profile: CatProfile = ADULT, goals: GoalEntry[] = GOALS) {
  const shared = createFakeStorage()
  void shared.set(catWeightKey('ofelia'), [
    {
      id: 'w1',
      ts: 1,
      at: '2026-11-21',
      kg: 4.32,
      createdBy: { accountId: 'a', name: 'Леша' },
    },
  ])
  void shared.set(catGoalKey('ofelia'), goals)
  const { model, calls } = makeTestCatsModel({
    todayIso: TODAY,
    storage: shared,
    catRegistry: [{ id: 'c1', ts: 1, catId: 'ofelia', op: 'add' }],
    litterRegistry: [{ id: 'l1', ts: 1, litterId: 'ofelia', op: 'add' }],
    profiles: { ofelia: profile },
  })
  const cat = atom(model.cat('ofelia'), 'test.cat')
  const today = atom<Temporal.PlainDate | null>(Temporal.PlainDate.from(TODAY), 'test.today')
  const form = makeGoalForm(cat, today, 'test.goal')
  const offs = [form.current, form.previous, form.hint, form.text, form.error].map((unit) =>
    unit.subscribe(() => {}),
  )
  return { form, calls, off: () => offs.forEach((off) => off()) }
}

/** Waits until the goal in force has loaded and filled the input. */
async function loadedGoal(form: ReturnType<typeof setup>['form']) {
  const text = wrap(() => form.text())
  await vi.waitFor(() => expect(text()).toBe('240'))
}

describe('makeGoalForm', () => {
  it('reads the goal in force, the one before it and the weight hint', async () => {
    const { form, off } = setup()
    const hint = wrap(() => form.hint())
    await vi.waitFor(() => expect(hint()).not.toBeNull())
    expect(form.current()).toEqual({ kcal: 240, since: Temporal.PlainDate.from('2026-11-01') })
    expect(form.previous()).toEqual({ kcal: 250, since: Temporal.PlainDate.from('2026-09-01') })
    expect(form.hint()).toEqual({ kind: 'available', kcal: 252, weightKg: 4.32 })
    expect(form.text()).toBe('240')
    off()
  })

  it('take() with a 4.32 kg sterilized adult sets 252 from today', async () => {
    const { form, calls, off } = setup()
    const hint = wrap(() => form.hint())
    await vi.waitFor(() => expect(hint()).not.toBeNull())

    await form.take()
    expect(calls).toContainEqual({
      action: 'setGoal',
      payload: { catId: 'ofelia', kcal: 252, since: TODAY },
    })
    off()
  })

  it('"40" is "От 50 до 1000 ккал" once saved, and sends nothing', async () => {
    const { form, calls, off } = setup()
    await loadedGoal(form)
    form.text.set('40')
    expect(form.error()).toBeNull()

    await form.save()
    expect(form.error()).toBe(GOAL_INPUT_ERROR)
    expect(GOAL_INPUT_ERROR).toBe('От 50 до 1000 ккал')
    expect(calls.filter((call) => call.action === 'setGoal')).toEqual([])
    off()
  })

  it('typing "1", "18", "180" shows no error on the way', async () => {
    const { form, off } = setup()
    await loadedGoal(form)
    for (const typed of ['1', '18', '180']) {
      form.text.set(typed)
      expect(form.error(), typed).toBeNull()
    }
    off()
  })

  it('a non-number or a goal over 1000 is an error at once', async () => {
    const { form, off } = setup()
    await loadedGoal(form)
    form.text.set('18a')
    expect(form.error()).toBe(GOAL_INPUT_ERROR)
    form.text.set('1001')
    expect(form.error()).toBe(GOAL_INPUT_ERROR)
    off()
  })

  it('save() sends a whole number from today', async () => {
    const { form, calls, off } = setup()
    await loadedGoal(form)
    form.text.set(' 230 ')
    expect(form.error()).toBeNull()

    await form.save()
    expect(calls).toContainEqual({
      action: 'setGoal',
      payload: { catId: 'ofelia', kcal: 230, since: TODAY },
    })
    off()
  })

  it('an empty input shows the error only after a save', async () => {
    const { form, calls, off } = setup()
    await loadedGoal(form)
    form.text.set('')
    expect(form.error()).toBeNull()

    await form.save()
    expect(form.error()).toBe(GOAL_INPUT_ERROR)
    expect(calls.filter((call) => call.action === 'setGoal')).toEqual([])
    off()
  })

  it('no goal yet: current and previous are null', async () => {
    const { form, off } = setup(ADULT, [])
    const hint = wrap(() => form.hint())
    await vi.waitFor(() => expect(hint()).not.toBeNull())
    expect(form.current()).toBeNull()
    expect(form.previous()).toBeNull()
    expect(form.text()).toBe('')
    off()
  })

  it('a kitten is left to a vet', async () => {
    const { form, off } = setup({ ...ADULT, birthDate: '2026-05-01' })
    const hint = wrap(() => form.hint())
    await vi.waitFor(() => expect(hint()).not.toBeNull())
    expect(form.hint()).toEqual({ kind: 'unavailable', reason: 'kitten' })
    off()
  })
})
