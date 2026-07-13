import { getAccount, listAccountDeviceIds } from '../src/auth/accounts'
import { revokeDevice } from '../src/auth/devices'
import type { AccountNotFoundError } from '../src/auth/errors'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export async function runRevokeDevices(
  ops: ValkeyOps,
  accountId: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ revoked: number } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const ids = await listAccountDeviceIds(ops, accountId)
  if (!dryRun) {
    for (const credentialId of ids) {
      await revokeDevice(ops, credentialId) // cascades that device's sessions
    }
  }
  return { revoked: ids.length }
}

export async function runRevokeDevicesCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--account')
  const accountId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!accountId) {
    console.error('Usage: revoke-devices --account <accountId> [--dry-run]')
    process.exit(1)
  }
  const dryRun = process.argv.includes('--dry-run')

  const ops = createValkeyOps()
  const result = await runRevokeDevices(ops, accountId, { dryRun })
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`Would revoke ${result.revoked} device(s) for account ${accountId}; account kept.`)
  } else {
    console.log(`Account ${accountId} kept; ${result.revoked} device(s) revoked.`)
  }
  process.exit(0)
}
