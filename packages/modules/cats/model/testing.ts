import {
  makeStaticWidgetIdentity,
  type StorageApi,
  type StorageError,
  type WidgetIdentity,
} from 'widget-runtime'
import { createFakeStorage, makeFakeFileSlots } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import type { CatProfile } from '../domain/cat'
import { OFELIA_ID } from '../domain/ids'
import {
  CATS_REGISTRY_KEY,
  LITTERS_REGISTRY_KEY,
  catProfileKey,
  ledgerKey,
  litterSettingsKey,
} from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import type { CatRegistryEvent, LitterRegistryEvent } from '../domain/registry'
import { makeCatsModel, type CatsModel } from './cats-model'
import type { CatsModuleContext, LitterModel } from './litter-model'

export type MakeTestCatsModelOptions = {
  /** Seeds Ofelia's litter ledger key. Omitted, the ledger key is absent. */
  entries?: LedgerEntry[]
  /** Seeds Ofelia's litter settings key with this raw value. Omitted, the key is absent. */
  settings?: unknown
  /** Seeds the cat registry key with these events. Omitted, the key is absent. */
  catRegistry?: CatRegistryEvent[]
  /** Seeds the litter registry key with these events. Omitted, the key is absent. */
  litterRegistry?: LitterRegistryEvent[]
  /** Seeds `cat/<id>/profile` for each entry. Omitted, no profile key exists. */
  profiles?: Record<string, CatProfile>
  /** The server-time "today". Omitted, the clock has not synced yet. */
  todayIso?: string
  /** Answers every API call. Omitted, every call resolves to `{ ok: true }`. */
  invoke?: (action: string, payload: unknown) => Promise<unknown>
  /** Backs the shared scope (client and server). Omitted, an in-memory fake. */
  storage?: StorageApi
  /** Backs `context.files`. Omitted, in-memory empty slots; pass slots to pre-fill or fail one. */
  files?: CatsModuleContext['files']
  /** Omitted, a static identity with no members and no viewer. */
  identity?: WidgetIdentity
}

/** Every API call a test model made, in order. */
export type TestModelCalls = { action: string; payload: unknown }[]

export type TestCatsModel = { model: CatsModel; calls: TestModelCalls }

export type TestLitterModel = { model: LitterModel; calls: TestModelCalls }

/** A `CatsModel` over in-memory storage, a fake clock and a recording API. */
export function makeTestCatsModel(options: MakeTestCatsModelOptions = {}): TestCatsModel {
  const storage = options.storage ?? createFakeStorage()
  // The fake's `set` writes synchronously before its first await, so the key is
  // seeded by the time the model's connect hook subscribes.
  if (options.entries) void storage.set(ledgerKey(OFELIA_ID), options.entries)

  if (options.settings !== undefined)
    void storage.set(litterSettingsKey(OFELIA_ID), options.settings)

  if (options.catRegistry) void storage.set(CATS_REGISTRY_KEY, options.catRegistry)
  if (options.litterRegistry) void storage.set(LITTERS_REGISTRY_KEY, options.litterRegistry)
  for (const [catId, profile] of Object.entries(options.profiles ?? {}))
    void storage.set(catProfileKey(catId), profile)

  const calls: TestModelCalls = []
  const answer = options.invoke ?? (async () => ({ ok: true }))
  const api = {
    invoke: (action: string, payload: unknown) => {
      calls.push({ action, payload })
      return answer(action, payload)
    },
  } as CatsModuleContext['api']

  const model = makeCatsModel({
    moduleId: 'cats',
    storage: { shared: { client: storage, server: storage } },
    files: options.files ?? makeFakeFileSlots(),
    api,
    timer: createFakeTimer({
      today: options.todayIso ? Temporal.PlainDate.from(options.todayIso) : null,
    }),
    identity: options.identity ?? makeStaticWidgetIdentity(),
  })

  return { model, calls }
}

/** Ofelia's `LitterModel` from `makeTestCatsModel`. */
export function makeTestLitterModel(options: MakeTestCatsModelOptions = {}): TestLitterModel {
  const { model, calls } = makeTestCatsModel(options)
  return { model: model.litter(OFELIA_ID), calls }
}

/**
 * `storage` with Ofelia's litter settings key failing with `failure`, both at connect time and on
 * `get`, until `recover()`; every other key behaves like `storage`. The ledger loads while the
 * rotation-dependent computeds stay at null: the partial failure a view must surface.
 */
export function makeSettingsDownStorage(storage: StorageApi, failure: StorageError) {
  const settingsKey = litterSettingsKey(OFELIA_ID)
  let down = true
  const get = (async (key: string, schema?: never) =>
    key === settingsKey && down ? failure : storage.get(key, schema)) as StorageApi['get']
  const api: StorageApi = {
    ...storage,
    get,
    subscribe: (key, listener, schema) => {
      if (key !== settingsKey) return storage.subscribe(key, listener, schema)
      queueMicrotask(() => listener(failure))
      return () => {}
    },
  }
  return {
    storage: api,
    recover: () => {
      down = false
    },
  }
}
