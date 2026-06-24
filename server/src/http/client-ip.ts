import type { IncomingMessage } from 'node:http'

/**
 * Best-effort client IP: first hop of x-forwarded-for, else the socket address.
 * Stored whole; the UI is responsible for only showing a tail.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string | null {
  const remoteAddress = req.socket.remoteAddress ?? null
  if (!remoteAddress) return null
  return normalizeIp(remoteAddress) || null
}

const normalizeIp = (ip: string) => {
  if (ip.startsWith('::ffff:')) return ip.slice(7)
  if (ip === '::1') return '127.0.0.1'
  return ip
}
