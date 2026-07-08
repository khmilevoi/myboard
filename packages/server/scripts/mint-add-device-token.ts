import { getAccount } from '../src/auth/accounts'
import { formatAddCode, mintAddToken } from '../src/auth/add-tokens'
import { parseDuration } from '../src/auth/config'
import type { AccountNotFoundError } from '../src/auth/errors'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

const DEFAULT_TTL_MS = 5 * 60_000

export async function runMintAddDeviceToken(
  ops: ValkeyOps,
  now: () => number,
  publicAppUrl: string,
  { accountId, ttlMs }: { accountId: string; ttlMs: number },
): Promise<{ url: string; code: string } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const { code } = await mintAddToken(ops, now, { accountId, ttlMs })
  return {
    url: `${publicAppUrl}/add-device?token=${code}`,
    code: formatAddCode(code),
  }
}

export async function runMintAddDeviceTokenCli(): Promise<void> {
  const accountIndex = process.argv.indexOf('--account')
  const accountId = accountIndex === -1 ? undefined : process.argv[accountIndex + 1]
  if (!accountId) {
    console.error('Usage: mint-add-device-token --account <accountId> [--ttl 5m]')
    process.exit(1)
  }

  const ttlIndex = process.argv.indexOf('--ttl')
  let ttlMs = DEFAULT_TTL_MS
  if (ttlIndex !== -1) {
    const parsed = parseDuration(process.argv[ttlIndex + 1] ?? '')
    if (parsed instanceof Error) {
      console.error(parsed.message)
      process.exit(1)
    }
    ttlMs = parsed
  }

  const publicAppUrl = process.env.PUBLIC_APP_URL
  if (!publicAppUrl) {
    console.error('PUBLIC_APP_URL is not set')
    process.exit(1)
  }

  const ops = createValkeyOps()
  const result = await runMintAddDeviceToken(ops, Date.now, publicAppUrl, { accountId, ttlMs })
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }
  console.log(result.url)
  console.log(`Code: ${result.code}`)
  process.exit(0)
}
