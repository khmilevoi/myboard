import type { IncomingMessage } from 'node:http'

/**
 * Best-effort client IP: first hop of x-forwarded-for, else the socket address.
 * Stored whole; the UI is responsible for only showing a tail.
 */
export function clientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string {
  const forwarded = req.headers['x-forwarded-for']
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded
  if (typeof first === 'string' && first.length > 0) return first.split(',')[0].trim()
  return req.socket.remoteAddress ?? ''
}
