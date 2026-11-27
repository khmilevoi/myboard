import { getAccount, listAccountDeviceIds } from '../src/auth/accounts'
import { revokeDevice } from '../src/auth/devices'
import type { AccountNotFoundError } from '../src/auth/errors'
import { accountDevicesKey, accountKey } from '../src/auth/records'
import { makeBlobStoreFromEnv, type BlobStore } from '../src/files/blob-store'
import { blobRecordKey } from '../src/files/records'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

/**
 * Removes the account, its devices (cascading their sessions) and its avatar. The avatar's blob
 * record goes first, which alone makes the image unreadable; without a usable `blobs` store the
 * object itself is left behind as a harmless orphan.
 */
export async function runRevokeAccount(
  ops: ValkeyOps,
  accountId: string,
  options: { blobs?: BlobStore | null } = {},
): Promise<{ devices: number; avatar: boolean } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const avatarId = account.avatar?.blobId ?? null
  if (avatarId !== null) {
    await ops.del(blobRecordKey(avatarId))
    const deleted = options.blobs ? await options.blobs.delete(avatarId) : null
    if (deleted instanceof Error) console.warn(deleted.message, deleted.cause)
  }

  const ids = await listAccountDeviceIds(ops, accountId)
  for (const credentialId of ids) {
    await revokeDevice(ops, credentialId) // cascades that device's sessions
  }
  await ops.del(accountDevicesKey(accountId))
  await ops.del(accountKey(accountId))
  return { devices: ids.length, avatar: avatarId !== null }
}

export async function runRevokeAccountCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--account')
  const accountId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!accountId) {
    console.error('Usage: revoke-account --account <accountId>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  // With FILES_S3_ENDPOINT the S3 credentials only exist inside the server (Garage bootstrap), so
  // the CLI then drops the avatar's record and leaves its object as an unreadable orphan.
  const blobs = makeBlobStoreFromEnv({ env: process.env, credentials: null })
  if (blobs instanceof Error) console.warn(`${blobs.message}; the avatar object is left in place`)
  const result = await runRevokeAccount(ops, accountId, {
    blobs: blobs instanceof Error ? null : blobs,
  })
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`Account ${accountId} removed (${result.devices} device(s) revoked).`)
  process.exit(0)
}
