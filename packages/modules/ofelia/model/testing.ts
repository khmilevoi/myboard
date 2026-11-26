import { makeStaticWidgetIdentity, type StorageApi, type WidgetIdentity } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { LEDGER_KEY } from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import { makeOfeliaModel, type OfeliaModel, type OfeliaModuleContext } from './ofelia-model'

export type MakeTestOfeliaModelOptions = {
  /** Seeds the shared ledger key. Omitted, the ledger key is absent. */
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

export type TestOfeliaModel = {
  model: OfeliaModel
  /** Every API call the model made, in order. */
  calls: { action: string; payload: unknown }[]
}

/** An `OfeliaModel` over in-memory storage, a fake clock and a recording API. */
export function makeTestOfeliaModel(options: MakeTestOfeliaModelOptions = {}): TestOfeliaModel {
  const storage = options.storage ?? createFakeStorage()
  // The fake's `set` writes synchronously before its first await, so the key is
  // seeded by the time the model's connect hook subscribes.
  if (options.entries) void storage.set(LEDGER_KEY, options.entries)

  const calls: TestOfeliaModel['calls'] = []
  const answer = options.invoke ?? (async () => ({ ok: true }))
  const api = {
    invoke: (action: string, payload: unknown) => {
      calls.push({ action, payload })
      return answer(action, payload)
    },
  } as OfeliaModuleContext['api']

  const model = makeOfeliaModel({
    moduleId: 'ofelia',
    storage: { shared: { client: storage, server: storage } },
    api,
    timer: createFakeTimer({
      today: options.todayIso ? Temporal.PlainDate.from(options.todayIso) : null,
    }),
    identity: options.identity ?? makeStaticWidgetIdentity(),
  })

  return { model, calls }
}
