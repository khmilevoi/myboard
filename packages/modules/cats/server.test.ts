// @vitest-environment node

import { context as reatomContext, wrap } from '@reatom/core'
import type { ModuleCronContext, ModuleServerContext } from '@shared/modules/contracts'
import type { WidgetServerStorage } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { catsActionSchemas } from './domain/actions'
import { defaultCatProfile } from './domain/cat'
import { EntityIdSchema, OFELIA_ID } from './domain/ids'
import {
  CATS_REGISTRY_KEY,
  LITTERS_REGISTRY_KEY,
  catGoalKey,
  catProfileKey,
  catWeightKey,
  ledgerKey,
  litterSettingsKey,
} from './domain/keys'
import { CatRegistryEventsSchema, foldCatRegistry } from './domain/registry'
import { DEFAULT_LITTER_SETTINGS, type LitterSettings } from './domain/roster'
import { makeTestCatsModel } from './model/testing'
import catsServer from './server'

afterEach(() => {
  reatomContext.reset()
})

const KARINA = { accountId: 'a1', name: 'Карина' }
// 2026-06-16 12:00 Europe/Warsaw
const NOW = Date.UTC(2026, 5, 16, 10, 0, 0)

const SWAPPED: LitterSettings = { rotation: ['Карина', 'Леша'], baseDate: '2026-06-16' }

/** A storage `get` that answers Ofelia's settings key with `settings` and every other key with `stored`. */
const answerGet = (stored: unknown, settings: unknown) =>
  vi.fn(async (key: string) => (key === litterSettingsKey(OFELIA_ID) ? settings : stored) as never)

function makeContext(stored: unknown = null, viewer = KARINA, settings: unknown = null) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const shared: WidgetServerStorage = {
    get: answerGet(stored, settings) as WidgetServerStorage['get'],
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  }

  const context = {
    moduleId: 'cats',
    viewer,
    now: () => NOW,
    api: { storage: { shared } },
  } as unknown as ModuleServerContext<'shared'>

  return { context, append }
}

const run = (
  event: keyof typeof catsServer.handlers,
  payload: unknown,
  context: ModuleServerContext<'shared'>,
) =>
  catsServer.handlers[event](
    catsServer.contract.actions[event].payload.parse(payload) as never,
    context,
  )

describe('cats server', () => {
  it('appends a cleaned entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it("reads the duty from the litter's stored settings", async () => {
    const { context, append } = makeContext([], KARINA, SWAPPED)

    await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)

    expect(append).toHaveBeenCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ type: 'cleaned', actor: 'Карина' }),
    )
  })

  it('falls back to the default rotation when the stored settings do not parse', async () => {
    const { context, append } = makeContext([], KARINA, { rotation: 'junk' })

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).toHaveBeenCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ type: 'cleaned', actor: 'Леша' }),
    )
  })

  it('stamps null when there is no session', async () => {
    const { context, append } = makeContext([], null as never)

    await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)

    expect(append.mock.calls[0][1]).toMatchObject({ createdBy: null })
  })

  it('half 1: the clean payload schema strips a forged createdBy/actor before parsing', () => {
    const parsed = catsServer.contract.actions.clean.payload.parse({
      litterId: OFELIA_ID,
      date: '2026-06-16',
      createdBy: { accountId: 'evil', name: 'Мимо' },
      actor: 'Карина',
    })

    expect(parsed).toEqual({ litterId: OFELIA_ID, date: '2026-06-16' })
  })

  it('half 1: the comment payload schema strips a forged createdBy before parsing', () => {
    const parsed = catsServer.contract.actions.comment.payload.parse({
      litterId: OFELIA_ID,
      weekStart: '2026-06-15',
      text: 'привет',
      createdBy: { accountId: 'evil', name: 'Мимо' },
    })

    expect(parsed).toEqual({ litterId: OFELIA_ID, weekStart: '2026-06-15', text: 'привет' })
  })

  it('half 2: the clean handler ignores createdBy/actor even when a caller bypasses the schema', async () => {
    const { context, append } = makeContext([])
    // Deliberately skips run()/payload.parse() — hands the handler a payload
    // that still carries createdBy/actor, as if the schema had already let
    // them through, to prove the handler itself never reads them.
    const forgedPayload = {
      litterId: OFELIA_ID,
      date: '2026-06-16',
      createdBy: { accountId: 'evil', name: 'Мимо' },
      actor: 'Карина',
    } as unknown as Parameters<(typeof catsServer.handlers)['clean']>[0]

    expect(await catsServer.handlers.clean(forgedPayload, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it('appends a debt entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('debt', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      createdBy: KARINA,
      by: 'Карина',
    })
  })

  it('is a silent no-op when forgiving a day that carries no debt', async () => {
    const { context, append } = makeContext([])

    expect(await run('forgive', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).not.toHaveBeenCalled()
  })

  it('is a silent no-op when undoing an open day', async () => {
    const { context, append } = makeContext([])

    expect(await run('undo', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).not.toHaveBeenCalled()
  })

  it('appends a comment under the viewed week key', async () => {
    const { context, append } = makeContext([])

    await run(
      'comment',
      { litterId: OFELIA_ID, weekStart: '2026-06-15', text: '  привет ' },
      context,
    )

    expect(append).toHaveBeenCalledWith('litter/ofelia/comments:2026-06-15', {
      text: 'привет',
      createdBy: KARINA,
      author: 'Карина',
    })
  })

  it("appends a day action to the payload litter's own ledger", async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { litterId: 'busya', date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(context.api.storage.shared.get).toHaveBeenCalledWith(
      'litter/busya/ledger',
      expect.anything(),
    )
    expect(append).toHaveBeenCalledWith('litter/busya/ledger', expect.anything())
  })

  it("appends a comment under the payload litter's week key", async () => {
    const { context, append } = makeContext([])

    await run('comment', { litterId: 'busya', weekStart: '2026-06-15', text: 'привет' }, context)

    expect(append).toHaveBeenCalledWith('litter/busya/comments:2026-06-15', expect.anything())
  })

  const FORGED_IDS = ['a/b', 'a:b', 'Ofelia'] as const

  it.each(
    (['clean', 'debt', 'forgive', 'undo'] as const).flatMap((event) =>
      FORGED_IDS.map((litterId) => [event, litterId] as const),
    ),
  )('the %s payload schema rejects the litter id %s', (event, litterId) => {
    expect(
      catsActionSchemas[event].payload.safeParse({ litterId, date: '2026-06-16' }).success,
    ).toBe(false)
    // The same payload with a key-safe id parses, so the id alone is what is rejected.
    expect(
      catsActionSchemas[event].payload.safeParse({ litterId: 'busya', date: '2026-06-16' }).success,
    ).toBe(true)
  })

  it.each(FORGED_IDS)('the comment payload schema rejects the litter id %s', (litterId) => {
    const payload = { weekStart: '2026-06-15', text: 'привет' }
    expect(catsActionSchemas.comment.payload.safeParse({ ...payload, litterId }).success).toBe(
      false,
    )
    expect(
      catsActionSchemas.comment.payload.safeParse({ ...payload, litterId: 'busya' }).success,
    ).toBe(true)
  })

  it('rejects a calendar-invalid date as a value instead of throwing', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-02-30' }, context)).toBeInstanceOf(
      Error,
    )
    expect(append).not.toHaveBeenCalled()
  })

  it('surfaces a storage read failure without writing', async () => {
    const failure = new Error('valkey down')
    const { context, append } = makeContext(failure)

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toBe(failure)
    expect(append).not.toHaveBeenCalled()
  })
})

function makeCronContext(
  stored: unknown = null,
  scheduledFor = Date.parse('2026-06-17T00:05:00+02:00'),
  settings: unknown = null,
) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const answer = answerGet(stored, settings)
  const shared = {
    get: vi.fn(async (key: string, schema?: unknown) => {
      if (key === CATS_REGISTRY_KEY) return [catAdd(OFELIA_ID, 1)] as never
      if (key === LITTERS_REGISTRY_KEY) return [litterAdd(OFELIA_ID, 1)] as never
      if (key === catProfileKey(OFELIA_ID)) return defaultCatProfile('Офелия', OFELIA_ID) as never
      return (answer as (k: string, s?: unknown) => Promise<never>)(key, schema)
    }),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  } as unknown as WidgetServerStorage

  const context = {
    moduleId: 'cats',
    now: () => scheduledFor,
    scheduledFor,
    api: { storage: { shared } },
  } as unknown as ModuleCronContext

  return { context, append }
}

// A seed record dated well before the auto-approve window, only to keep the
// ledger non-empty in tests that exercise a widget that has already been
// used at least once (a genuinely empty/absent ledger is covered by the
// F11 no-op test below, and must not reach these assertions).
const SEED_ENTRY = {
  id: 'seed',
  ts: 0,
  date: '2026-01-01',
  type: 'cleaned' as const,
  actor: 'Леша' as const,
  createdBy: null,
}

describe('cats auto-approve cron', () => {
  it('closes the unresolved window with system-authored entries', async () => {
    const { context, append } = makeCronContext([SEED_ENTRY])

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: { system: true },
      by: 'Леша',
    })
  })

  it("closes the window by the litter's stored rotation", async () => {
    const { context, append } = makeCronContext([SEED_ENTRY], undefined, SWAPPED)

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenLastCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ date: '2026-06-16', actor: 'Карина' }),
    )
  })

  it('still closes the window, by the default rotation, when the stored settings do not parse', async () => {
    const { context, append } = makeCronContext([SEED_ENTRY], undefined, { rotation: 'junk' })

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ date: '2026-06-16', actor: 'Леша' }),
    )
  })

  it('returns the storage error instead of throwing', async () => {
    const { context, append } = makeCronContext(null)
    context.api.storage.shared.get = vi.fn(async () => new Error('valkey down') as never)

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeInstanceOf(Error)
    expect(append).not.toHaveBeenCalled()
  })

  it('closes nothing when the active cat profile is absent or does not parse', async () => {
    for (const profile of [null, { name: '' }]) {
      const { context, append } = makeCronContext([SEED_ENTRY])
      const baseGet = context.api.storage.shared.get
      context.api.storage.shared.get = vi.fn(
        async (key: string, schema?: never): Promise<never> =>
          key === catProfileKey(OFELIA_ID)
            ? (profile as never)
            : (baseGet(key, schema) as Promise<never>),
      )

      expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
      expect(append).not.toHaveBeenCalled()
    }
  })

  it('returns the profile read error without closing any litter', async () => {
    const { context, append } = makeCronContext([SEED_ENTRY])
    const baseGet = context.api.storage.shared.get
    context.api.storage.shared.get = vi.fn(
      async (key: string, schema?: never): Promise<never> =>
        key === catProfileKey(OFELIA_ID)
          ? (new Error('valkey down') as never)
          : (baseGet(key, schema) as Promise<never>),
    )

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeInstanceOf(Error)
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op, with no append, when the ledger key does not exist (F11)', async () => {
    // Every stack ships this module's server.ts, so its cron is registered
    // everywhere regardless of whether the widget was ever placed on a
    // board. A missing ledger key means nobody has ever used it — nothing
    // to auto-approve, and the job must not fabricate history by writing.
    const { context, append } = makeCronContext(null)

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op, with no append, when the ledger key resolves to an empty array (F11)', async () => {
    const { context, append } = makeCronContext([])

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).not.toHaveBeenCalled()
  })

  it('skips a day that a concurrent manual close resolved after the initial read (F10)', async () => {
    // 06-13 is the 4th day of the 7-day window (06-10 … 06-16). Simulate a
    // widget dispatch that manually closes it in the gap between the job's
    // initial read (call #1) and the fresh re-check this job now does right
    // before appending that day's draft (call #5: initial + 3 prior re-checks
    // for 06-10, 06-11, 06-12).
    const manualClose = {
      id: 'manual-1',
      ts: 999,
      date: '2026-06-13',
      type: 'cleaned' as const,
      actor: 'Карина' as const,
      createdBy: KARINA,
    }

    let calls = 0
    const { context, append } = makeCronContext([SEED_ENTRY])
    const baseGet = context.api.storage.shared.get
    context.api.storage.shared.get = vi.fn(async (key: string, schema?: never): Promise<never> => {
      if (key !== ledgerKey(OFELIA_ID)) return baseGet(key, schema) as Promise<never>
      calls += 1
      return (calls >= 5 ? [SEED_ENTRY, manualClose] : [SEED_ENTRY]) as never
    })

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()

    // 06-10, 06-11, 06-12, 06-14, 06-15, 06-16 still get the system close;
    // 06-13 does not, because the manual close already resolved it by the
    // time this job re-checked that specific day.
    expect(append).toHaveBeenCalledTimes(6)
    expect(append).not.toHaveBeenCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ date: '2026-06-13' }),
    )
  })
})

/**
 * A Map-backed shared storage whose `append` stamps `id` and `ts` the way the real one does, so a
 * handler's later reads see its earlier writes.
 */
function makeMapStorage(seed: Record<string, unknown> = {}, failAppendTo?: string) {
  const store = new Map<string, unknown>(Object.entries(seed))
  /** Every write, in call order, as `set <key>` / `append <key>`. */
  const writes: string[] = []
  let seq = 0
  const storage: WidgetServerStorage = {
    get: async (key, schema) => {
      const value = store.get(key) ?? null
      if (value === null || !schema) return value as never
      return schema.parse(value)
    },
    set: async (key, value) => {
      writes.push(`set ${key}`)
      store.set(key, value)
    },
    delete: async (key) => {
      store.delete(key)
    },
    has: async (key) => store.has(key),
    keys: async () => [...store.keys()],
    append: async (key, entry) => {
      writes.push(`append ${key}`)
      if (key === failAppendTo) return new Error(`append ${key} failed`)
      seq += 1
      const current = (store.get(key) as unknown[] | undefined) ?? []
      store.set(key, [...current, { id: `id-${seq}`, ts: NOW + seq, ...entry }])
    },
  }
  return { store, storage, writes }
}

const catAdd = (catId: string, ts: number) => ({ id: `c-${catId}`, ts, catId, op: 'add' })
const litterAdd = (litterId: string, ts: number) => ({
  id: `l-${litterId}`,
  ts,
  litterId,
  op: 'add',
})

/** Ofelia registered with her own litter, plus `extraCats` sharing it. */
function makeRegistryContext(extraCats: string[] = [], failAppendTo?: string) {
  const { store, storage, writes } = makeMapStorage(
    {
      [CATS_REGISTRY_KEY]: [OFELIA_ID, ...extraCats].map((catId, index) =>
        catAdd(catId, index + 1),
      ),
      [LITTERS_REGISTRY_KEY]: [litterAdd(OFELIA_ID, 1)],
    },
    failAppendTo,
  )
  const context = {
    moduleId: 'cats',
    viewer: KARINA,
    now: () => NOW,
    api: { storage: { shared: storage } },
  } as unknown as ModuleServerContext<'shared'>
  return { store, context, writes }
}

const PROFILE_FIELDS = {
  name: 'Офелия',
  breed: 'Британская',
  birthDate: '2021-04-01',
  sex: 'female',
  sterilized: 'yes',
  bodyCondition: 5,
  avatar: null,
} as const

/** The `catId` of a successful `addCat` result; fails the test on anything else. */
function addedCat(result: unknown): { catId: string } {
  expect(result).toEqual({ ok: true, catId: expect.any(String) })
  return result as { catId: string }
}

const litterIdsIn = (store: Map<string, unknown>) =>
  (store.get(LITTERS_REGISTRY_KEY) as { litterId: string }[]).map((event) => event.litterId)

describe('cats server: registries, profile, goal and weight', () => {
  it('adds a cat with a new litter: litter first, then the profile, then the registry add', async () => {
    const { store, context, writes } = makeRegistryContext()

    const result = await run('addCat', { name: ' Буся ', litter: { kind: 'new' } }, context)

    expect(result).toEqual({ ok: true, catId: expect.any(String) })
    const { catId } = addedCat(result)
    expect(EntityIdSchema.safeParse(catId).success).toBe(true)

    const litterIds = litterIdsIn(store)
    expect(litterIds).toHaveLength(2)
    const newLitterId = litterIds[1]
    expect(newLitterId).not.toBe(OFELIA_ID)
    expect(EntityIdSchema.safeParse(newLitterId).success).toBe(true)
    expect(store.get(litterSettingsKey(newLitterId))).toEqual(DEFAULT_LITTER_SETTINGS)

    expect(store.get(catProfileKey(catId))).toEqual(defaultCatProfile('Буся', newLitterId))
    expect(store.get(CATS_REGISTRY_KEY)).toContainEqual(
      expect.objectContaining({ catId, op: 'add' }),
    )
    expect(writes).toEqual([
      `append ${LITTERS_REGISTRY_KEY}`,
      `set ${litterSettingsKey(newLitterId)}`,
      `set ${catProfileKey(catId)}`,
      `append ${CATS_REGISTRY_KEY}`,
    ])
  })

  it('leaves no cat in the model when the registry add fails after the profile write', async () => {
    const { store, context, writes } = makeRegistryContext([], CATS_REGISTRY_KEY)

    const result = await run(
      'addCat',
      { name: 'Буся', litter: { kind: 'existing', litterId: OFELIA_ID } },
      context,
    )

    expect(result).toBeInstanceOf(Error)
    const profileKeys = [...store.keys()].filter((key) => /^cat\/[^/]+\/profile$/.test(key))
    expect(profileKeys).toHaveLength(1)
    expect(store.get(profileKeys[0])).toEqual(defaultCatProfile('Буся', OFELIA_ID))
    expect(writes).toEqual([`set ${profileKeys[0]}`, `append ${CATS_REGISTRY_KEY}`])
    expect(
      foldCatRegistry(CatRegistryEventsSchema.parse(store.get(CATS_REGISTRY_KEY))),
    ).toMatchObject({
      active: [OFELIA_ID],
      archived: [],
    })

    // A client model over exactly what the half-finished request left behind.
    const clientStorage = createFakeStorage()
    for (const [key, value] of store) void clientStorage.set(key, value)
    void clientStorage.set(catProfileKey(OFELIA_ID), defaultCatProfile('Офелия', OFELIA_ID))
    const { model } = makeTestCatsModel({ storage: clientStorage })

    await reatomContext.start(async () => {
      const off = model.cats.subscribe(() => {})
      const read = wrap(() => model.cats())

      await vi.waitFor(() =>
        expect(read()).toEqual([
          { id: OFELIA_ID, name: 'Офелия', avatar: null, litterId: OFELIA_ID, tone: 'a' },
        ]),
      )
      off()
    })
  })

  it('adds a cat to an existing litter', async () => {
    const { store, context, writes } = makeRegistryContext()

    const result = await run(
      'addCat',
      { name: 'Буся', litter: { kind: 'existing', litterId: OFELIA_ID } },
      context,
    )

    const { catId } = addedCat(result)
    expect(store.get(catProfileKey(catId))).toEqual(defaultCatProfile('Буся', OFELIA_ID))
    expect(litterIdsIn(store)).toEqual([OFELIA_ID])
    expect(writes).toEqual([`set ${catProfileKey(catId)}`, `append ${CATS_REGISTRY_KEY}`])
  })

  it('refuses an unknown existing litter and writes nothing', async () => {
    const { store, context } = makeRegistryContext()
    const before = structuredClone([...store.entries()])

    const result = await run(
      'addCat',
      { name: 'Буся', litter: { kind: 'existing', litterId: 'nope' } },
      context,
    )

    expect(result).toBeInstanceOf(PublicWidgetError)
    expect(result).toMatchObject({ code: 'unknown_litter', status: 404 })
    expect([...store.entries()]).toEqual(before)
  })

  it('refuses to archive the only active cat', async () => {
    const { store, context } = makeRegistryContext()

    const result = await run('archiveCat', { catId: OFELIA_ID }, context)

    expect(result).toBeInstanceOf(PublicWidgetError)
    expect(result).toMatchObject({ code: 'last_active_cat', status: 409 })
    expect(store.get(CATS_REGISTRY_KEY)).toHaveLength(1)
  })

  it('refuses a cat id that is not in the registry', async () => {
    const { store, context } = makeRegistryContext()
    const before = structuredClone([...store.entries()])

    for (const [event, payload] of [
      ['archiveCat', { catId: 'ghost' }],
      ['restoreCat', { catId: 'ghost' }],
      ['weigh', { catId: 'ghost', kg: 4, at: '2026-06-16' }],
      ['setGoal', { catId: 'ghost', kcal: 220, since: '2026-06-16' }],
      [
        'saveProfile',
        {
          catId: 'ghost',
          profile: PROFILE_FIELDS,
          litter: { kind: 'existing', litterId: OFELIA_ID },
        },
      ],
    ] as const) {
      const result = await run(event, payload, context)
      expect(result, event).toBeInstanceOf(PublicWidgetError)
      expect(result, event).toMatchObject({ code: 'unknown_cat', status: 404 })
    }
    expect([...store.entries()]).toEqual(before)
  })

  it('archives and restores a cat through the registry', async () => {
    const { store, context } = makeRegistryContext(['busya'])
    const registry = () =>
      foldCatRegistry(CatRegistryEventsSchema.parse(store.get(CATS_REGISTRY_KEY)))

    expect(await run('archiveCat', { catId: 'busya' }, context)).toMatchObject({ ok: true })
    expect(registry()).toMatchObject({
      active: [OFELIA_ID],
      archived: [{ catId: 'busya', archivedAt: expect.any(Number) }],
    })

    expect(await run('restoreCat', { catId: 'busya' }, context)).toEqual({ ok: true })
    expect(registry()).toMatchObject({ active: [OFELIA_ID, 'busya'], archived: [] })
  })

  it('keeps one cat active when the last two are archived concurrently', async () => {
    const { store, context } = makeRegistryContext(['busya'])

    const results = await Promise.all([
      run('archiveCat', { catId: OFELIA_ID }, context),
      run('archiveCat', { catId: 'busya' }, context),
    ])

    // Both handlers read two active cats before either appended, so both answered ok.
    expect(results).toEqual([{ ok: true }, { ok: true }])
    const events = CatRegistryEventsSchema.parse(store.get(CATS_REGISTRY_KEY))
    expect(events.filter((event) => event.op === 'archive')).toHaveLength(2)
    expect(foldCatRegistry(events).active).toHaveLength(1)
  })

  it('appends a weighing stamped with the viewer', async () => {
    const { store, context } = makeRegistryContext()

    expect(await run('weigh', { catId: OFELIA_ID, kg: 4.32, at: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(store.get(catWeightKey(OFELIA_ID))).toEqual([
      {
        id: expect.any(String),
        ts: expect.any(Number),
        at: '2026-06-16',
        kg: 4.32,
        createdBy: KARINA,
      },
    ])
  })

  it('appends a goal', async () => {
    const { store, context } = makeRegistryContext()

    expect(
      await run('setGoal', { catId: OFELIA_ID, kcal: 220, since: '2026-06-16' }, context),
    ).toEqual({ ok: true })
    expect(store.get(catGoalKey(OFELIA_ID))).toEqual([
      { id: expect.any(String), ts: expect.any(Number), kcal: 220, since: '2026-06-16' },
    ])
  })

  it('saves the profile with the chosen litter', async () => {
    const { store, context } = makeRegistryContext()

    expect(
      await run(
        'saveProfile',
        {
          catId: OFELIA_ID,
          profile: PROFILE_FIELDS,
          litter: { kind: 'existing', litterId: OFELIA_ID },
        },
        context,
      ),
    ).toEqual({ ok: true })
    expect(store.get(catProfileKey(OFELIA_ID))).toEqual({ ...PROFILE_FIELDS, litterId: OFELIA_ID })
  })

  it('saves the profile onto a new litter', async () => {
    const { store, context } = makeRegistryContext()

    expect(
      await run(
        'saveProfile',
        { catId: OFELIA_ID, profile: PROFILE_FIELDS, litter: { kind: 'new' } },
        context,
      ),
    ).toEqual({ ok: true })

    const litterIds = litterIdsIn(store)
    expect(litterIds).toHaveLength(2)
    expect(store.get(catProfileKey(OFELIA_ID))).toEqual({
      ...PROFILE_FIELDS,
      litterId: litterIds[1],
    })
    expect(store.get(litterSettingsKey(litterIds[1]))).toEqual(DEFAULT_LITTER_SETTINGS)
  })

  it.each([
    ['addCat', { name: 'Буся', litter: { kind: 'existing', litterId: 'Ofelia' } }],
    ['archiveCat', { catId: 'a/b' }],
    ['restoreCat', { catId: 'a:b' }],
    ['weigh', { catId: 'Ofelia', kg: 4, at: '2026-06-16' }],
    ['setGoal', { catId: 'a/b', kcal: 220, since: '2026-06-16' }],
    ['saveProfile', { catId: 'a:b', profile: PROFILE_FIELDS, litter: { kind: 'new' } }],
    ['addCat', { name: 'Буся', litter: { kind: 'existing', litterId: 'a:b' } }],
    ['archiveCat', { catId: 'Ofelia' }],
    ['restoreCat', { catId: 'a/b' }],
    ['weigh', { catId: 'a:b', kg: 4, at: '2026-06-16' }],
    ['setGoal', { catId: 'Ofelia', kcal: 220, since: '2026-06-16' }],
    [
      'saveProfile',
      { catId: OFELIA_ID, profile: PROFILE_FIELDS, litter: { kind: 'existing', litterId: 'a/b' } },
    ],
  ] as const)('the %s payload schema rejects a forged id', (event, payload) => {
    expect(catsActionSchemas[event].payload.safeParse(payload).success).toBe(false)
  })
})
