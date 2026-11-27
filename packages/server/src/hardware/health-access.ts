import { PROFILE_KEY } from '@modules/health/domain/keys'
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
