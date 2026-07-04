import { mkdtempSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { diagnosticsDefinition } from '../diagnostics'
import { makeChromiumExecutor } from './chromium-executor'

// Real browser tests are opt-in: they need a Chromium binary and a display
// (Xvfb in the container). Run with BROWSER_IT=1 on Linux/container or a
// headed-capable dev host.
const run = process.env.BROWSER_IT === '1'

describe.skipIf(!run)('chromium executor (real browser)', () => {
  let server: Server
  let url = ''

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<!doctype html><title>fixture</title><body>ok</body>')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  })

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('runs the diagnostics task against a real browser', async () => {
    const secretsDir = mkdtempSync(path.join(tmpdir(), 'it-secrets-'))
    writeFileSync(path.join(secretsDir, '__diagnostics___probe'), 'x')
    const executor = makeChromiumExecutor({
      profileDir: mkdtempSync(path.join(tmpdir(), 'it-profile-')),
      secretsDir,
    })
    const context = await executor.acquire(new AbortController().signal, '__diagnostics__')
    if (context instanceof Error) throw context
    const result = await diagnosticsDefinition.handlers['browser-check']({}, context)
    await executor.release(context)
    await executor.shutdown()
    expect(result).toMatchObject({ ok: true, secretPresent: true })
    expect(String((result as { userAgent: string }).userAgent)).toContain('Mozilla')
  })

  it('persists the profile across a relaunch', async () => {
    const profileDir = mkdtempSync(path.join(tmpdir(), 'it-persist-'))
    const secretsDir = mkdtempSync(path.join(tmpdir(), 'it-persist-secrets-'))

    const first = makeChromiumExecutor({ profileDir, secretsDir })
    const c1 = await first.acquire(new AbortController().signal, 'demo')
    if (c1 instanceof Error) throw c1
    await c1.page.goto(url)
    await c1.page.evaluate("localStorage.setItem('probe','kept')")
    await first.release(c1)
    await first.shutdown()

    const second = makeChromiumExecutor({ profileDir, secretsDir })
    const c2 = await second.acquire(new AbortController().signal, 'demo')
    if (c2 instanceof Error) throw c2
    await c2.page.goto(url)
    const value = await c2.page.evaluate("localStorage.getItem('probe')")
    await second.release(c2)
    await second.shutdown()
    expect(value).toBe('kept')
  })
})
