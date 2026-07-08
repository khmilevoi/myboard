import { getAccount } from '../src/auth/accounts'
import { getDevice, listAllDeviceCredentialIds } from '../src/auth/devices'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export type DeviceListing = {
  accountId: string
  accountName: string
  devices: Array<{
    credentialId: string
    label: string
    status: 'active' | 'pending'
    disabled: boolean
    createdAt: string
    lastSeenAt: string
  }>
}

export async function runListDevices(ops: ValkeyOps): Promise<DeviceListing[]> {
  const ids = await listAllDeviceCredentialIds(ops)
  const byAccount = new Map<string, DeviceListing>()

  for (const id of ids) {
    const device = await getDevice(ops, id)
    if (device instanceof Error) continue

    let listing = byAccount.get(device.accountId)
    if (!listing) {
      const account = await getAccount(ops, device.accountId)
      listing = {
        accountId: device.accountId,
        accountName: account instanceof Error ? '<unknown>' : account.name,
        devices: [],
      }
      byAccount.set(device.accountId, listing)
    }

    listing.devices.push({
      credentialId: device.credentialId,
      label: device.label,
      status: device.status,
      disabled: device.disabled,
      createdAt: new Date(device.createdAt).toISOString(),
      lastSeenAt: new Date(device.lastSeenAt).toISOString(),
    })
  }

  return [...byAccount.values()]
}

export async function runListDevicesCli(): Promise<void> {
  const ops = createValkeyOps()
  const listing = await runListDevices(ops)
  if (listing.length === 0) {
    console.log('No devices.')
    process.exit(0)
  }
  for (const account of listing) {
    console.log(`${account.accountName} (${account.accountId})`)
    for (const device of account.devices) {
      const flags = [device.status, device.disabled ? 'disabled' : null].filter(Boolean).join(', ')
      console.log(`  ${device.credentialId}  ${device.label}  [${flags}]  last seen ${device.lastSeenAt}`)
    }
  }
  process.exit(0)
}
