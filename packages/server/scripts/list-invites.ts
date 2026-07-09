import { type InviteStatus, inviteStatus, listAllInvites } from '../src/auth/invites'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export type InviteListing = {
  id: string
  label?: string
  createdBy?: string
  createdAt: string
  expiresAt: string
  uses: number
  maxUses: number
  status: InviteStatus
}

const STATUS_ORDER: Record<InviteStatus, number> = {
  active: 0,
  consumed: 1,
  locked: 2,
  expired: 3,
}

export async function runListInvites(ops: ValkeyOps, now: () => number): Promise<InviteListing[]> {
  const records = await listAllInvites(ops)

  const listing: InviteListing[] = records.map((record) => ({
    id: record.id,
    ...(record.label !== undefined ? { label: record.label } : {}),
    ...(record.createdBy !== undefined ? { createdBy: record.createdBy } : {}),
    createdAt: new Date(record.createdAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    uses: record.uses,
    maxUses: record.maxUses,
    status: inviteStatus(record, now),
  }))

  listing.sort((a, b) => {
    const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
    return order !== 0 ? order : a.createdAt.localeCompare(b.createdAt)
  })

  return listing
}

export async function runListInvitesCli(): Promise<void> {
  const ops = createValkeyOps()
  const listing = await runListInvites(ops, () => Date.now())
  if (listing.length === 0) {
    console.log('No invites.')
    process.exit(0)
  }
  for (const invite of listing) {
    console.log(
      `${invite.id}  ${invite.label ?? '(no label)'}  by ${invite.createdBy ?? '<unknown>'}  ` +
        `created ${invite.createdAt}  expires ${invite.expiresAt}  ` +
        `uses ${invite.uses}/${invite.maxUses}  [${invite.status}]`,
    )
  }
  process.exit(0)
}
