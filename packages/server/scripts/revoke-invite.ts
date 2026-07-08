import { revokeInviteById } from '../src/auth/invites'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export function runRevokeInvite(ops: ValkeyOps, id: string): Promise<boolean> {
  return revokeInviteById(ops, id)
}

export async function runRevokeInviteCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--id')
  const id = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!id) {
    console.error('Usage: revoke-invite --id <inviteId>')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const revoked = await runRevokeInvite(ops, id)
  if (!revoked) {
    console.error(`No live invite with id ${id}`)
    process.exit(1)
  }
  console.log(`Invite ${id} revoked.`)
  process.exit(0)
}
