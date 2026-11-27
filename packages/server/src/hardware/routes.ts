import { randomUUID } from 'node:crypto'

import { HARDWARE_EVENTS_KEY } from '@shared/hardware/board-api'
import {
  GatewayEventsBodySchema,
  GatewayRegisterBodySchema,
} from '@shared/hardware/gateway-protocol'
import type Router from 'find-my-way'

import type { AuthDeps } from '../auth/handlers'
import { type SseRegistry, writeSseEvent } from '../realtime/sse'
import { publishChange } from '../storage/handlers'
import type { StorageEvent } from '../storage/schemas'
import type { ValkeyOps } from '../storage/valkey'
import { makeGatewayConnections } from './connections'
import { GatewayUnauthorizedError, HardwarePublishError } from './errors'
import { handleGatewayEvent } from './gateway-events'
import {
  type HardwareDeps,
  logHardwareFailure,
  readBody,
  requireBoardSession,
  sendHardwareError,
  sendJson,
} from './http'
import {
  authenticateGateway,
  mintGatewayCode,
  registerGateway,
  revokeGateway,
} from './registration'
import { buildSnapshot } from './snapshot'
import { updateGateway } from './store'

const BOARD_HEARTBEAT_MS = 25_000

export type HardwareRoutes = {
  /** Storage pub/sub events, after fanout. A no-op until profile changes are tracked. */
  onStorageEvent(event: StorageEvent): void
  /** Ends every gateway stream so `server.close` can finish. */
  closeAll(): void
}

export function registerHardwareRoutes({
  router,
  ops,
  now,
  authDeps,
  registry,
}: {
  router: Router.Instance<Router.HTTPVersion.V1>
  ops: ValkeyOps
  now: () => number
  authDeps: AuthDeps
  registry: SseRegistry
}): HardwareRoutes {
  const connections = makeGatewayConnections()
  const deps: HardwareDeps = {
    ops,
    now,
    connections,
    publish: (event) =>
      publishChange(ops, HARDWARE_EVENTS_KEY, event).catch(
        (cause: unknown) => new HardwarePublishError({ cause }),
      ),
  }

  // A board refresh that failed after the write succeeded must not fail the write.
  async function announceChanged(context: string): Promise<void> {
    const published = await deps.publish({ type: 'changed' })
    if (published instanceof Error) logHardwareFailure(`${context} publish`, published)
  }

  // ---- Board routes: session + CSRF header ----

  router.on('GET', '/api/hardware', async (req, res) => {
    const session = await requireBoardSession(authDeps, req, res)
    if (session === null) return
    const snapshot = await buildSnapshot(ops, connections, session.accountId)
    if (snapshot instanceof Error) return sendHardwareError(res, snapshot)
    sendJson(res, 200, snapshot)
  })

  router.on('POST', '/api/hardware/codes', async (req, res) => {
    const session = await requireBoardSession(authDeps, req, res)
    if (session === null) return
    const minted = await mintGatewayCode(ops, now, { accountId: session.accountId })
    if (minted instanceof Error) return sendHardwareError(res, minted)
    sendJson(res, 201, { code: minted.code, expiresAt: minted.expiresAt })
  })

  router.on('DELETE', '/api/hardware/gateways/:gatewayId', async (req, res, params) => {
    const session = await requireBoardSession(authDeps, req, res)
    if (session === null) return
    const gatewayId = params.gatewayId as string
    const revoked = await revokeGateway(ops, gatewayId)
    if (revoked instanceof Error) return sendHardwareError(res, revoked)
    connections.close(gatewayId)
    await announceChanged('revoke')
    res.writeHead(204)
    res.end()
  })

  router.on('GET', '/api/hardware/events', async (req, res) => {
    const session = await requireBoardSession(authDeps, req, res)
    if (session === null) return
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const connId = randomUUID()
    registry.add(connId, res)
    registry.subscribe(connId, [HARDWARE_EVENTS_KEY])
    writeSseEvent(res, 'ready', { connId })
    const heartbeat = setInterval(() => res.write(': ping\n\n'), BOARD_HEARTBEAT_MS)
    req.on('close', () => {
      clearInterval(heartbeat)
      registry.remove(connId)
    })
  })

  // ---- Gateway routes: bearer token (register: one-time code); CSRF-exempt ----

  router.on('POST', '/api/hardware/gateway/register', async (req, res) => {
    const body = await readBody(req, res, GatewayRegisterBodySchema)
    if (body === null) return
    const registered = await registerGateway(ops, now, body)
    if (registered instanceof Error) return sendHardwareError(res, registered)
    // The code is spent and the record stored: the token is answered even if the board misses it.
    await announceChanged('register')
    // The only response that ever carries the token.
    sendJson(res, 201, { gatewayId: registered.gatewayId, token: registered.token })
  })

  router.on('GET', '/api/hardware/gateway/stream', async (req, res) => {
    let clientGone = false
    res.on('close', () => {
      clientGone = true
    })

    // Runs from an event listener, so it must never reject: every failure is logged and dropped.
    const recordDisconnect = async (gatewayId: string): Promise<void> => {
      const seen = await updateGateway(ops, gatewayId, (current) => ({
        ...current,
        lastSeenAt: now(),
      })).catch((cause: unknown) =>
        cause instanceof Error ? cause : new Error('gateway update failed', { cause }),
      )
      if (seen instanceof Error) return logHardwareFailure('stream close', seen)
      // Revoked meanwhile: the revoke already told the board.
      if (seen === null) return
      await announceChanged('stream close')
    }

    const gateway = await authenticateGateway(ops, now, req.headers.authorization)
    if (gateway instanceof Error) return sendHardwareError(res, gateway)
    // Gone while authenticating: no connection to record.
    if (clientGone) return
    const connected = await updateGateway(ops, gateway.id, (current) => ({
      ...current,
      connectedAt: now(),
    }))
    if (connected instanceof Error) return sendHardwareError(res, connected)
    // Revoked between authentication and now.
    if (connected === null) return sendHardwareError(res, new GatewayUnauthorizedError())
    // Gone during the update: close the record out so lastSeenAt follows connectedAt.
    if (clientGone) return recordDisconnect(gateway.id)

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    // `ready` and attach happen in one synchronous step, so no command can precede `ready` and the
    // gateway is online by the time it reads it.
    writeSseEvent(res, 'ready', { gatewayId: gateway.id })
    connections.attach(gateway.id, res)
    res.on('close', () => {
      connections.detach(gateway.id, res)
      void recordDisconnect(gateway.id)
    })
    // Headers are sent: from here a failure may only be logged, never answered.
    await announceChanged('stream open')
  })

  router.on('POST', '/api/hardware/gateway/events', async (req, res) => {
    const gateway = await authenticateGateway(ops, now, req.headers.authorization)
    if (gateway instanceof Error) return sendHardwareError(res, gateway)
    const body = await readBody(req, res, GatewayEventsBodySchema)
    if (body === null) return
    for (const event of body.events) {
      // Stops at the first failure; the gateway resends the batch and handlers are idempotent.
      const handled = await handleGatewayEvent(deps, gateway, event)
      if (handled instanceof Error) return sendHardwareError(res, handled)
    }
    res.writeHead(204)
    res.end()
  })

  return {
    onStorageEvent: () => {},
    closeAll: () => connections.closeAll(),
  }
}
