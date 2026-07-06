import { publishChange } from '../storage/handlers'
import type { ValkeyOps } from '../storage/valkey'
import { authAccountKey } from './records'

export type AuthDeviceEvent = {
  type: 'device-pending' | 'device-approved' | 'device-denied' | 'device-revoked'
  credentialId: string
  label?: string
}

export async function publishAuthDeviceEvent(
  ops: ValkeyOps,
  accountId: string,
  event: AuthDeviceEvent,
): Promise<void> {
  await publishChange(ops, authAccountKey(accountId), event)
}
