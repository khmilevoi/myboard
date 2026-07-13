import { type InvitePruneResult, pruneInvites } from '../src/auth/invites'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export function runPruneInvites(
  ops: ValkeyOps,
  now: () => number,
  opts?: { dryRun?: boolean },
): Promise<InvitePruneResult> {
  return pruneInvites(ops, now, opts)
}

export async function runPruneInvitesCli(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  const ops = createValkeyOps()
  const result = await runPruneInvites(ops, Date.now, { dryRun })

  for (const { id, status } of result.pruned) {
    console.log(`${id}  [${status}]`)
  }

  const verb = dryRun ? 'Would prune' : 'Pruned'
  console.log(`${verb} ${result.pruned.length} invite(s), kept ${result.kept}.`)
  process.exit(0)
}
