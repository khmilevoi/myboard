import type { ServerResponse } from 'node:http'

import type { GatewayCommand } from '@shared/hardware/gateway-protocol'

import { writeSseEvent } from '../realtime/sse'

const HEARTBEAT_MS = 25_000

export type GatewayConnections = {
  /** Makes `res` the gateway's command stream, ending any previous stream of that gateway. */
  attach(gatewayId: string, res: ServerResponse): void
  /** No-op unless `res` is the gateway's current stream. */
  detach(gatewayId: string, res: ServerResponse): void
  isOnline(gatewayId: string): boolean
  /** Writes `event: command`; `false` when the gateway has no open stream. */
  send(gatewayId: string, command: GatewayCommand): boolean
  /** Ends the gateway's stream, if any. */
  close(gatewayId: string): void
  /** Ends every stream and clears every heartbeat, so `server.close` can finish. */
  closeAll(): void
}

type Connection = { res: ServerResponse; heartbeat: ReturnType<typeof setInterval> }

/** In-process gateway presence: one server process per stack, so no cross-process state. */
export function makeGatewayConnections(): GatewayConnections {
  const connections = new Map<string, Connection>()

  const drop = (gatewayId: string): Connection | undefined => {
    const current = connections.get(gatewayId)
    if (current === undefined) return undefined
    clearInterval(current.heartbeat)
    connections.delete(gatewayId)
    return current
  }

  return {
    attach(gatewayId, res) {
      drop(gatewayId)?.res.end()
      const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
      connections.set(gatewayId, { res, heartbeat })
    },
    detach(gatewayId, res) {
      if (connections.get(gatewayId)?.res === res) drop(gatewayId)
    },
    isOnline: (gatewayId) => connections.has(gatewayId),
    send(gatewayId, command) {
      const current = connections.get(gatewayId)
      if (current === undefined) return false
      writeSseEvent(current.res, 'command', command)
      return true
    },
    close(gatewayId) {
      drop(gatewayId)?.res.end()
    },
    closeAll() {
      // Deleting the visited entry during Map iteration is safe.
      for (const gatewayId of connections.keys()) drop(gatewayId)?.res.end()
    },
  }
}
