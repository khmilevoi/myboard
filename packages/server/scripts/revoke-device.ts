import { getDevice, revokeDevice } from '../src/auth/devices'
import { DeviceNotFoundError } from '../src/auth/errors'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export async function runRevokeDevice(
  ops: ValkeyOps,
  credentialId: string,
): Promise<{ accountId: string } | DeviceNotFoundError | Error> {
  const device = await getDevice(ops, credentialId)
  if (device instanceof Error) return device

  await revokeDevice(ops, credentialId)
  return { accountId: device.accountId }
}

export async function runRevokeDeviceCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--credential-id')
  const credentialId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!credentialId) {
    console.error('Usage: revoke-device --credential-id <id>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const result = await runRevokeDevice(ops, credentialId)
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(`Revoked ${credentialId} (account ${result.accountId}); its sessions are gone.`)
  process.exit(0)
}
