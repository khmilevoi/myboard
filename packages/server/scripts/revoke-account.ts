import { getAccount, listAccountDeviceIds } from '../src/auth/accounts'
import { revokeDevice } from '../src/auth/devices'
import type { AccountNotFoundError } from '../src/auth/errors'
import { accountDevicesKey, accountKey } from '../src/auth/records'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export async function runRevokeAccount(
  ops: ValkeyOps,
  accountId: string,
): Promise<{ devices: number } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const ids = await listAccountDeviceIds(ops, accountId)
  for (const credentialId of ids) {
    await revokeDevice(ops, credentialId) // cascades that device's sessions
  }
  await ops.del(accountDevicesKey(accountId))
  await ops.del(accountKey(accountId))
  return { devices: ids.length }
}

export async function runRevokeAccountCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--account')
  const accountId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!accountId) {
    console.error('Usage: revoke-account --account <accountId>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const result = await runRevokeAccount(ops, accountId)
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`Account ${accountId} removed (${result.devices} device(s) revoked).`)
  process.exit(0)
}
