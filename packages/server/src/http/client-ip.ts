import type { IncomingMessage } from 'node:http'

/**
 * Best-effort client IP: first hop of x-forwarded-for, else the socket address.
 * Stored whole; the UI is responsible for only showing a tail.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string | null {
  const forwardedFor = firstForwardedFor(req.headers['x-forwarded-for'])
  if (forwardedFor) return normalizeIp(forwardedFor) || null

  const remoteAddress = req.socket.remoteAddress ?? null
  if (!remoteAddress) return null
  return normalizeIp(remoteAddress) || null
}

const firstForwardedFor = (header: IncomingMessage['headers']['x-forwarded-for']) => {
  const value = Array.isArray(header) ? header[0] : header
  return value?.split(',')[0]?.trim() ?? null
}

const normalizeIp = (ip: string) => {
  if (ip.startsWith('::ffff:')) return ip.slice(7)
  if (ip === '::1') return '127.0.0.1'
  return ip
}
