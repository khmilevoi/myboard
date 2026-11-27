import { spawnSync, type SpawnSyncReturns } from 'node:child_process'

// Only Valkey runs in Docker here; Playwright runs on the host so `--headed`
// opens a real, visible Chromium window (see docs/superpowers/specs/2026-07-05-e2e-headed-command-design.md
// for why this is simpler than containerizing the browser itself).
const composeFile = 'docker-compose.e2e.yml'

// `shell: true` so the pnpm shim resolves the same way it would from a
// terminal, regardless of how the current Node version manager installs it
// (a plain `pnpm` file, a `pnpm.cmd` shim, etc. all vary by setup). Every
// argument here is a static literal, not external input, so there's no
// injection risk from enabling the shell.
function statusOf(result: SpawnSyncReturns<Buffer>): number {
  if (result.error) {
    console.error(result.error)
    return 1
  }
  return result.status ?? 1
}

function runDocker(args: string[]): number {
  return statusOf(
    spawnSync('docker', ['compose', '-f', composeFile, ...args], { stdio: 'inherit' }),
  )
}

// Valkey is published on an ephemeral host port (see docker-compose.e2e.yml),
// so ask Compose where it landed instead of assuming 6379.
function valkeyHostAddress(): string | undefined {
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'port', 'valkey', '6379'], {
    encoding: 'utf8',
  })
  if (result.status !== 0) return undefined
  return result.stdout.trim() || undefined
}

function main(): number {
  try {
    const upStatus = runDocker(['up', '-d', '--wait', 'valkey'])
    if (upStatus !== 0) return upStatus

    const valkeyAddress = valkeyHostAddress()
    if (valkeyAddress === undefined) {
      console.error('Could not resolve the host port Valkey was published on')
      return 1
    }

    return statusOf(
      spawnSync('pnpm', ['--filter', 'client', 'exec', 'playwright', 'test', '--headed'], {
        stdio: 'inherit',
        shell: true,
        env: {
          ...process.env,
          VALKEY_URL: `redis://${valkeyAddress}`,
          ALLOW_TEST_DB_RESET: '1',
        },
      }),
    )
  } finally {
    runDocker(['down', '-v'])
  }
}

process.exitCode = main()
