import { makeStaticWidgetIdentity, type StorageApi } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { ingestMeasurement } from '../domain/ingest'
import { PROFILE_KEY } from '../domain/keys'
import type { Measurement } from '../domain/measurement'
import type { Profile } from '../domain/profile'
import { makeHealthModel, type HealthModel, type HealthModuleContext } from './health-model'

export type MakeTestHealthModelOptions = {
  /** Ingested in order through the real `ingestMeasurement`. */
  measurements?: Measurement[]
  /** Seeds the profile key. Omitted, the key is absent. */
  profile?: Profile
  /** Backs the account scope (client and server). Omitted, an in-memory fake. */
  storage?: StorageApi
  /** Answers every API call. Omitted, every call resolves to `{ ok: true }`. */
  invoke?: (action: string, payload: unknown) => Promise<unknown>
}

export type TestHealthModel = {
  model: HealthModel
  storage: StorageApi
  /** Every API call the model made, in order. */
  calls: { action: string; payload: unknown }[]
  /** Resolves once every seeded measurement has been ingested (ingest is async). */
  ready: Promise<void>
}

/** A `HealthModel` over in-memory account storage seeded exactly as the server would store it. */
export function makeTestHealthModel(options: MakeTestHealthModelOptions = {}): TestHealthModel {
  const storage = options.storage ?? createFakeStorage()
  if (options.profile) void storage.set(PROFILE_KEY, options.profile)

  // StorageApi is structurally a WidgetServerStorage, so the production ingest runs unchanged
  // against the fake: month ledgers and latest/<kind> keys cannot drift from the server's.
  const ready = (async () => {
    for (const measurement of options.measurements ?? []) {
      const result = await ingestMeasurement(storage, measurement)
      if (result instanceof Error) throw result
    }
  })()

  const calls: TestHealthModel['calls'] = []
  const answer = options.invoke ?? (async () => ({ ok: true }))
  const api = {
    invoke: (action: string, payload: unknown) => {
      calls.push({ action, payload })
      return answer(action, payload)
    },
  } as HealthModuleContext['api']

  const model = makeHealthModel({
    moduleId: 'health',
    storage: { account: { client: storage, server: storage } },
    api,
    timer: createFakeTimer({ today: null }),
    identity: makeStaticWidgetIdentity(),
  })

  return { model, storage, calls, ready }
}
