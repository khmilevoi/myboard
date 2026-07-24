import type { IncomingMessage } from 'node:http'
import { connect as connectTcp } from 'node:net'
import type { Duplex } from 'node:stream'

import { parseCookies } from '../auth/cookies'
import type { RecoveryCapabilityStore, RecoveryConnection } from './capability'

export const RECOVERY_SOCKET_PATH = '/api/browser/recovery/socket'

// Handshake headers are forwarded verbatim so the browser and websockify
// negotiate end to end. Everything else -- Cookie above all -- is dropped: no
// board credential may reach the browser container.
const HANDSHAKE_HEADERS = [
  'upgrade',
  'connection',
  'sec-websocket-key',
  'sec-websocket-version',
  'sec-websocket-protocol',
  'sec-websocket-extensions',
] as const

export type RecoveryTunnelDeps = {
  store: RecoveryCapabilityStore
  upstreamUrl: string
  maxSessionMs: number
  cookieName: string
  resolveSession: (req: IncomingMessage) => Promise<{ sessionId: string } | null>
}

function refuse(socket: Duplex, status: number, reason: string): void {
  // No negotiated protocol exists yet, so a bare status line is the only way to
  // say no. Never include a body: it would describe internal state.
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

function upgradeRequestFor(req: IncomingMessage, host: string): string {
  const lines = ['GET / HTTP/1.1', `Host: ${host}`]
  for (const name of HANDSHAKE_HEADERS) {
    const value = req.headers[name]
    if (typeof value === 'string') lines.push(`${name}: ${value}`)
  }
  return `${lines.join('\r\n')}\r\n\r\n`
}

export function makeRecoveryTunnel(deps: RecoveryTunnelDeps) {
  const upstreamUrl = new URL(deps.upstreamUrl)
  const upstreamPort = Number(upstreamUrl.port || 80)

  return async function handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    socket.on('error', () => socket.destroy())

    let attached: RecoveryConnection | null = null

    try {
      const path = (req.url ?? '').split('?')[0]
      if (path !== RECOVERY_SOCKET_PATH) return refuse(socket, 404, 'Not Found')

      const session = await deps.resolveSession(req)
      if (!session) return refuse(socket, 401, 'Unauthorized')
      if (socket.destroyed) return
      if (deps.store.isBusy()) return refuse(socket, 409, 'Conflict')

      const token = parseCookies(req.headers.cookie)[deps.cookieName]
      const capability = deps.store.consume({ token, sessionId: session.sessionId })
      if (capability instanceof Error) return refuse(socket, 401, 'Unauthorized')

      const upstream = connectTcp({ host: upstreamUrl.hostname, port: upstreamPort })
      let settled = false
      let timer: NodeJS.Timeout | null = null

      const connection: RecoveryConnection = {
        widgetId: capability.widgetId,
        destroy: () => {
          upstream.destroy()
          socket.destroy()
        },
      }

      const teardown = () => {
        if (timer) clearTimeout(timer)
        timer = null
        deps.store.detach(connection)
        upstream.destroy()
        socket.destroy()
      }

      deps.store.attach(connection)
      attached = connection

      upstream.on('connect', () => {
        settled = true
        upstream.write(upgradeRequestFor(req, `${upstreamUrl.hostname}:${upstreamPort}`))
        if (head.length > 0) upstream.write(head)
        socket.pipe(upstream)
        upstream.pipe(socket)
        timer = setTimeout(teardown, deps.maxSessionMs)
        timer.unref?.()
      })

      upstream.on('error', () => {
        deps.store.detach(connection)
        if (!settled) {
          refuse(socket, 503, 'Service Unavailable')
          return
        }
        teardown()
      })

      upstream.on('close', teardown)
      socket.on('close', teardown)
    } catch {
      if (attached) deps.store.detach(attached)
      if (!socket.destroyed) refuse(socket, 500, 'Internal Server Error')
    }
  }
}
