import { ingestMeasurement } from '@modules/health/domain/ingest'
import { PROFILE_KEY } from '@modules/health/domain/keys'
import type { Measurement } from '@modules/health/domain/measurement'
import { type Profile, ProfileSchema } from '@modules/health/domain/profile'
import { moduleAccountNamespace } from '@shared/storage/scope'
import type { WidgetServerStorage } from '@shared/widgets/contracts'

import type { ValkeyOps } from '../storage/valkey'
import { makeWidgetScopedStorage } from '../widgets/storage'

/** The health module's account scope of `accountId`, exactly as the module itself reaches it. */
export function healthStorageFor(
  ops: ValkeyOps,
  now: () => number,
  accountId: string,
): WidgetServerStorage {
  return makeWidgetScopedStorage({
    ops,
    namespace: moduleAccountNamespace('health', accountId),
    now,
  })
}

/** The account's health profile; `null` when none was saved. Never log what this returns. */
export function readHealthProfile(
  ops: ValkeyOps,
  now: () => number,
  accountId: string,
): Promise<Profile | null | Error> {
  return healthStorageFor(ops, now, accountId).get(PROFILE_KEY, ProfileSchema)
}

/**
 * Writes `measurement` into the account's health data through the module's own ingest, so the
 * ledger, `latest/<kind>` and the scoped stream behave exactly as for any other source. Never
 * rejects; never log what it is given.
 */
export async function ingestForAccount(
  ops: ValkeyOps,
  now: () => number,
  accountId: string,
  measurement: Measurement,
): Promise<{ stored: boolean } | Error> {
  const result = await ingestMeasurement(healthStorageFor(ops, now, accountId), measurement).catch(
    (cause: unknown) => (cause instanceof Error ? cause : new Error('ingest failed', { cause })),
  )
  return result
}
