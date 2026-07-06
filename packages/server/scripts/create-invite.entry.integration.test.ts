import { execFile } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const VALKEY_URL = 'redis://localhost:6379'

async function isValkeyReachable(): Promise<boolean> {
  const url = new URL(VALKEY_URL)
  const port = Number(url.port || 6379)
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: url.hostname, port })
    const done = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(1000, () => done(false))
  })
}

describe('create-invite.cjs entry (built bundle)', () => {
  it('actually runs main() and prints an activate URL', async (context) => {
    const reachable = await isValkeyReachable()
    if (!reachable) {
      context.skip()
      return
    }

    const bundlePath = path.resolve(import.meta.dirname, '../dist/scripts/create-invite.cjs')

    const { stdout } = await execFileAsync(
      'node',
      [bundlePath, '--label', 'entry-integration-test'],
      {
        env: {
          ...process.env,
          VALKEY_URL,
          PUBLIC_APP_URL: 'http://localhost:5173',
          RP_ID: 'localhost',
          RP_NAME: 'MyBoard',
          EXPECTED_ORIGIN: 'http://localhost:5173',
        },
      },
    )

    expect(stdout).toMatch(/\/activate\?token=.+/)
  })
})
