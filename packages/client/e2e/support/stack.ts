import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

/**
 * One isolated app stack per Playwright worker: its own test-server process
 * (own clock, own rate limits) on its own Valkey database (own FLUSHDB, and a
 * pub/sub channel namespaced by that database in test-server.ts), behind its
 * own `vite preview` origin (own cookies, own service worker).
 *
 * The suite used to share ONE test-server and ONE database across every
 * worker, so `/api/test/reset` and `/api/test/time` in one spec file silently
 * rewrote another file's in-flight test; the only cure was `workers: 1`.
 * With a stack per worker, workers cannot observe each other at all.
 */
export type E2EStack = {
  /** Origin of this worker's preview server — the `baseURL` every test gets. */
  baseURL: string
  /** This worker's test-server, for test-only control calls. */
  apiURL: string
}

const clientDir = resolve(import.meta.dirname, '..', '..')
const serverEntry = resolve(clientDir, '..', 'server', 'dist', 'test-server.cjs')
const viteBin = resolve(
  dirname(createRequire(resolve(clientDir, 'package.json')).resolve('vite/package.json')),
  'bin',
  'vite.js',
)

// Far from the dev ports (8787 / 4173 / 5173+) so a running `pnpm dev`,
// `pnpm preview` or another checkout's stack can never be attached to by
// accident — `--strictPort` turns any collision into a loud failure instead.
const API_PORT_BASE = 18787
const PREVIEW_PORT_BASE = 14173
// Valkey ships 16 databases; 0 is left to whatever else uses that instance.
const MAX_WORKERS = 15

const STARTUP_TIMEOUT_MS = 60_000
const LOG_TAIL_LINES = 60

type Proc = { name: string; child: ChildProcess; log: string[] }

function startProcess(name: string, args: string[], env: Record<string, string>): Proc {
  const child = spawn(process.execPath, args, {
    cwd: clientDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const log: string[] = []
  const collect = (chunk: Buffer): void => {
    log.push(...chunk.toString().split(/\r?\n/).filter(Boolean))
    if (log.length > LOG_TAIL_LINES) log.splice(0, log.length - LOG_TAIL_LINES)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  return { name, child, log }
}

function describeFailure(proc: Proc, reason: string): Error {
  return new Error(`${proc.name} ${reason}\n--- last output ---\n${proc.log.join('\n')}`)
}

async function waitUntilServing(proc: Proc, url: string): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (proc.child.exitCode !== null) {
      throw describeFailure(proc, `exited with code ${proc.child.exitCode} before serving ${url}`)
    }
    const ok = await fetch(url).then(
      (response) => response.ok,
      () => false,
    )
    if (ok) return
    await new Promise((settle) => setTimeout(settle, 100))
  }
  throw describeFailure(proc, `did not serve ${url} within ${STARTUP_TIMEOUT_MS} ms`)
}

async function stopProcess(proc: Proc): Promise<void> {
  const { child } = proc
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((settle) => child.once('exit', () => settle()))
  child.kill('SIGTERM')
  const killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000)
  await exited
  clearTimeout(killTimer)
}

function valkeyUrlForDatabase(database: number): string {
  const url = new URL(process.env['VALKEY_URL'] ?? 'redis://localhost:6379')
  url.pathname = `/${database}`
  return url.toString()
}

export async function startStack(parallelIndex: number): Promise<{
  stack: E2EStack
  stop: () => Promise<void>
}> {
  if (parallelIndex >= MAX_WORKERS) {
    throw new Error(`e2e supports at most ${MAX_WORKERS} workers (one Valkey database each)`)
  }
  const apiPort = API_PORT_BASE + parallelIndex
  const previewPort = PREVIEW_PORT_BASE + parallelIndex
  // The browser-facing origin must be `localhost` (it is the WebAuthn RP ID),
  // but everything Node talks to uses an explicit 127.0.0.1. `localhost` is
  // ambiguous: in the e2e container it resolves to ::1 first, so a preview
  // bound to "localhost" listened on ::1 only while Node's fetch dialled
  // 127.0.0.1 and got ECONNREFUSED. Chromium tries both families, so binding
  // the preview to 127.0.0.1 serves it as well.
  const baseURL = `http://localhost:${previewPort}`
  const previewProbeURL = `http://127.0.0.1:${previewPort}`
  const apiURL = `http://127.0.0.1:${apiPort}`

  const server = startProcess(`test-server[${parallelIndex}]`, [serverEntry], {
    PORT: String(apiPort),
    VALKEY_URL: valkeyUrlForDatabase(parallelIndex + 1),
    RP_ID: 'localhost',
    RP_NAME: 'MyBoard',
    EXPECTED_ORIGIN: baseURL,
    PUBLIC_APP_URL: baseURL,
  })
  const preview = startProcess(
    `vite-preview[${parallelIndex}]`,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(previewPort), '--strictPort'],
    { VITE_API_PROXY: apiURL },
  )
  const stop = async (): Promise<void> => {
    await Promise.all([stopProcess(preview), stopProcess(server)])
  }

  try {
    await Promise.all([
      waitUntilServing(server, `${apiURL}/api/time`),
      waitUntilServing(preview, `${previewProbeURL}/widgets/clock/remoteEntry.js`),
    ])
  } catch (error) {
    await stop()
    throw error
  }

  // A worker that restarts after a failure reuses its parallelIndex — and so
  // its database. Start every worker from an empty one.
  const reset = await fetch(`${apiURL}/api/test/reset`, { method: 'POST' })
  if (!reset.ok) {
    await stop()
    throw new Error(`reset of worker ${parallelIndex}'s database failed: ${reset.status}`)
  }

  return { stack: { baseURL, apiURL }, stop }
}
