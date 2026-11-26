import { defineModuleServer } from '@shared/modules/contracts'

import { healthContract } from './domain/contract'
import { PROFILE_KEY, latestKey, monthKeysInRange } from './domain/keys'
import { MeasurementLedgerSchema, MeasurementSchema, type Measurement } from './domain/measurement'
import { ProfileSchema } from './domain/profile'
import { mergeSeries } from './domain/series'

const OK = { ok: true } as const

const healthServer = defineModuleServer(healthContract, {
  handlers: {
    getProfile: async (_payload, context) =>
      context.api.storage.account.get(PROFILE_KEY, ProfileSchema),

    setProfile: async (profile, context) => {
      const written = await context.api.storage.account.set(PROFILE_KEY, profile)
      if (written instanceof Error) return written
      return OK
    },

    listMeasurements: async ({ kinds, from, to }, context) => {
      const ledgers: Measurement[][] = []
      for (const key of monthKeysInRange(from, to)) {
        const ledger = await context.api.storage.account.get(key, MeasurementLedgerSchema)
        if (ledger instanceof Error) return ledger
        ledgers.push(ledger ?? [])
      }
      return mergeSeries(ledgers).filter(
        (m) =>
          m.takenAt >= from &&
          m.takenAt <= to &&
          (kinds === undefined || kinds.some((kind) => m.metrics[kind] !== undefined)),
      )
    },

    latestMeasurement: async ({ kind }, context) =>
      context.api.storage.account.get(latestKey(kind), MeasurementSchema),
  },
})

export default healthServer
