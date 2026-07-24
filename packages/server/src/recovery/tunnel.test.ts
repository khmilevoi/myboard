import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { makeRecoveryCapabilityStore, type RecoveryCapabilityStore } from './capability'
import { makeRecoveryTunnel, RECOVERY_SOCKET_PATH } from './tunnel'

type Upstream = {
  server: WebSocketServer
  url: string
  received: Buffer[]
  lastHeaders: Record<string, string | string[] | undefined>
  send: (data: Buffer) => void
  close: () => Promise<void>
}

async function startUpstream(): Promise<Upstream> {
  const received: Buffer[] = []
  let lastHeaders: Record<string, string | string[] | undefined> = {}
  let socket: WebSocket | null = null
  const server = new WebSocketServer({ port: 0 })
  server.on('connection', (ws, req) => {
    socket = ws
    lastHeaders = req.headers
    ws.on('message', (data: Buffer) => received.push(Buffer.from(data)))
  })
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const { port } = server.address() as AddressInfo
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    received,
    get lastHeaders() {
      return lastHeaders
    },
    send: (data) => socket?.send(data),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

describe('makeRecoveryTunnel', () => {
  let upstream: Upstream
  let server: Server
  let store: RecoveryCapabilityStore
  let base: string
  let nowMs: number

  beforeEach(async () => {
    nowMs = 1_000
    upstream = await startUpstream()
    store = makeRecoveryCapabilityStore({ now: () => nowMs, tokenTtlMs: 60_000 })
    const tunnel = makeRecoveryTunnel({
      store,
      upstreamUrl: upstream.url,
      maxSessionMs: 60_000,
      cookieName: 'mb_recovery',
      resolveSession: async (req) =>
        req.headers.cookie?.includes('session=good') ? { sessionId: 's-1' } : null,
    })
    server = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    server.on('upgrade', (req, socket, head) => {
      void tunnel(req, socket, head)
    })
    await new Promise<void>((resolve) => server.listen(0, resolve))
    base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    store.revokeAll()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await upstream.close()
  })

  function connect(cookie: string) {
    return new WebSocket(`${base}${RECOVERY_SOCKET_PATH}`, { headers: { cookie } })
  }

  function opened(ws: WebSocket) {
    return new Promise<Error | 'open'>((resolve) => {
      ws.on('open', () => resolve('open'))
      ws.on('error', (error) => resolve(error))
    })
  }

  it('pipes binary frames in both directions and hides board cookies', async () => {
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const ws = connect(`session=good; mb_recovery=${token}`)

    expect(await opened(ws)).toBe('open')
    ws.send(Buffer.from('RFB 003.008\n'))
    await expect
      .poll(() => upstream.received.map((chunk) => chunk.toString()))
      .toEqual(['RFB 003.008\n'])
    expect(upstream.lastHeaders.cookie).toBeUndefined()

    const fromUpstream = new Promise<string>((resolve) =>
      ws.on('message', (data: Buffer) => resolve(Buffer.from(data).toString())),
    )
    upstream.send(Buffer.from('RFB 003.008\n'))
    expect(await fromUpstream).toBe('RFB 003.008\n')

    ws.close()
  })

  it('rejects a connection without a board session', async () => {
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const result = await opened(connect(`mb_recovery=${token}`))

    expect(result).toBeInstanceOf(Error)
    expect(String(result)).toContain('401')
  })

  it('rejects missing, reused, and expired capabilities', async () => {
    expect(String(await opened(connect('session=good')))).toContain('401')

    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const first = connect(`session=good; mb_recovery=${token}`)
    expect(await opened(first)).toBe('open')
    first.close()
    await expect.poll(() => store.isBusy()).toBe(false)
    expect(String(await opened(connect(`session=good; mb_recovery=${token}`)))).toContain('401')

    const expired = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    nowMs += 60_001
    expect(String(await opened(connect(`session=good; mb_recovery=${expired.token}`)))).toContain(
      '401',
    )
  })

  it('refuses a second concurrent connection and keeps the first alive', async () => {
    const first = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const firstSocket = connect(`session=good; mb_recovery=${first.token}`)
    expect(await opened(firstSocket)).toBe('open')

    const second = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    expect(String(await opened(connect(`session=good; mb_recovery=${second.token}`)))).toContain(
      '409',
    )
    expect(firstSocket.readyState).toBe(WebSocket.OPEN)

    firstSocket.close()
  })

  it('destroys the live connection when the capability is revoked', async () => {
    const { token } = store.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
    const ws = connect(`session=good; mb_recovery=${token}`)
    expect(await opened(ws)).toBe('open')

    const closed = new Promise<void>((resolve) => ws.on('close', () => resolve()))
    store.revoke('passport-checker')

    await closed
    expect(store.isBusy()).toBe(false)
  })

  it('rejects any other upgrade path', async () => {
    const ws = new WebSocket(`${base}/api/storage/events`, {
      headers: { cookie: 'session=good' },
    })
    expect(String(await opened(ws))).toContain('404')
  })

  it('refuses cleanly and never rejects when resolveSession throws', async () => {
    const flakyStore = makeRecoveryCapabilityStore({ now: () => nowMs, tokenTtlMs: 60_000 })
    const flakyTunnel = makeRecoveryTunnel({
      store: flakyStore,
      upstreamUrl: upstream.url,
      maxSessionMs: 60_000,
      cookieName: 'mb_recovery',
      resolveSession: async () => {
        throw new Error('valkey down')
      },
    })
    const flakyServer = createServer((_req, res) => {
      res.writeHead(404)
      res.end()
    })
    // Deliberately no `.catch` here: this proves the tunnel handler itself
    // never rejects, not that app.ts's defense-in-depth catch saves us.
    flakyServer.on('upgrade', (req, socket, head) => {
      void flakyTunnel(req, socket, head)
    })
    await new Promise<void>((resolve) => flakyServer.listen(0, resolve))
    const flakyBase = `ws://127.0.0.1:${(flakyServer.address() as AddressInfo).port}`

    try {
      const { token } = flakyStore.issue({ widgetId: 'passport-checker', sessionId: 's-1' })
      const ws = new WebSocket(`${flakyBase}${RECOVERY_SOCKET_PATH}`, {
        headers: { cookie: `session=good; mb_recovery=${token}` },
      })
      const result = await opened(ws)

      expect(result).toBeInstanceOf(Error)
      expect(String(result)).toContain('500')
      expect(flakyStore.isBusy()).toBe(false)
    } finally {
      flakyStore.revokeAll()
      await new Promise<void>((resolve) => flakyServer.close(() => resolve()))
    }
  })
})
