import * as errore from 'errore'

import { createInvite } from '../src/auth/invites'
import { loadAuthConfig, parseDuration } from '../src/auth/config'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export class CliArgsError extends errore.createTaggedError({
  name: 'CliArgsError',
  message: 'Invalid CLI argument: $reason',
}) {}

const DEFAULT_TTL = '7d'
const DEFAULT_MAX_USES = 1

export type CreateInviteArgs = {
  label?: string
  ttlMs: number
  maxUses: number
}

export function parseArgs(argv: string[]): CreateInviteArgs | CliArgsError {
  let label: string | undefined
  let ttlRaw = DEFAULT_TTL
  let maxUsesRaw = String(DEFAULT_MAX_USES)

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--label') {
      label = value
      i++
    } else if (flag === '--ttl') {
      ttlRaw = value ?? ttlRaw
      i++
    } else if (flag === '--max-uses') {
      maxUsesRaw = value ?? maxUsesRaw
      i++
    }
  }

  const ttlMs = parseDuration(ttlRaw)
  if (ttlMs instanceof Error) {
    return new CliArgsError({ reason: `--ttl ${ttlRaw} is not a valid duration` })
  }

  if (!/^\d+$/.test(maxUsesRaw)) {
    return new CliArgsError({ reason: `--max-uses ${maxUsesRaw} is not a number` })
  }
  const maxUses = Number(maxUsesRaw)

  return {
    ...(label !== undefined ? { label } : {}),
    ttlMs,
    maxUses,
  }
}

export async function runCreateInvite(
  ops: ValkeyOps,
  now: () => number,
  publicAppUrl: string,
  args: CreateInviteArgs,
): Promise<string> {
  const { token } = await createInvite(ops, now, {
    ttlMs: args.ttlMs,
    maxUses: args.maxUses,
    ...(args.label !== undefined ? { label: args.label } : {}),
  })

  return `${publicAppUrl}/activate?token=${token}`
}

async function main(): Promise<void> {
  const config = loadAuthConfig(process.env)
  if (config instanceof Error) {
    console.error(`Invalid auth configuration: ${config.message}`)
    process.exit(1)
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL
  if (!publicAppUrl) {
    console.error('PUBLIC_APP_URL is not set')
    process.exit(1)
  }

  const args = parseArgs(process.argv.slice(2))
  if (args instanceof Error) {
    console.error(args.message)
    process.exit(1)
  }

  const ops = createValkeyOps()
  const url = await runCreateInvite(ops, Date.now, publicAppUrl, args)
  console.log(url)
  process.exit(0)
}

if (require.main === module) {
  void main()
}
