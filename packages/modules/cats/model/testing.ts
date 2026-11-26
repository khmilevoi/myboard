import { makeStaticWidgetIdentity, type StorageApi, type WidgetIdentity } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { OFELIA_ID } from '../domain/ids'
import { ledgerKey } from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import { makeCatsModel, type CatsModel } from './cats-model'
import type { CatsModuleContext, LitterModel } from './litter-model'

export type MakeTestCatsModelOptions = {
  /** Seeds Ofelia's litter ledger key. Omitted, the ledger key is absent. */
  entries?: LedgerEntry[]
  /** The server-time "today". Omitted, the clock has not synced yet. */
  todayIso?: string
  /** Answers every API call. Omitted, every call resolves to `{ ok: true }`. */
  invoke?: (action: string, payload: unknown) => Promise<unknown>
  /** Backs the shared scope (client and server). Omitted, an in-memory fake. */
  storage?: StorageApi
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
