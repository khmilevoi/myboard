import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

const VALKEY_URL = 'redis://localhost:6379'
const BUNDLE_PATH = path.resolve(import.meta.dirname, '../dist/scripts/create-invite.cjs')

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
    // Two preconditions, both outside this suite's control, both skipped
    // rather than failed. Valkey was always one of them; the built bundle has
    // to be the other. `dist/` is gitignored and nothing in `pnpm test` builds
    // it, so while only Valkey was guarded this test was green purely because
    // nothing was listening on 6379 -- and any run with a stack up went red on
    // MODULE_NOT_FOUND instead. `pnpm start:docker` publishes 6379, and
    // `pnpm test:e2e:nginx` requires that stack, so "run the gate after the
    // e2e suite" reproduced it every time, in a file the diff never touched.
    // Run `pnpm --filter server build` first to actually exercise this.
    if (!existsSync(BUNDLE_PATH) || !(await isValkeyReachable())) {
      context.skip()
      return
    }

    const { stdout } = await execFileAsync(
      'node',
      [BUNDLE_PATH, '--label', 'entry-integration-test'],
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
