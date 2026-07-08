import type { IncomingMessage } from 'node:http'

import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'

const MUTATING_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH'])

/**
 * Router-level CSRF check: mutating /api requests must carry the custom
 * header only same-origin app code sets. /api/test/* is exempt (dead in
 * production without ALLOW_TEST_DB_RESET=1; keeps e2e seeding helpers plain).
 */
export function csrfBlocked(req: Pick<IncomingMessage, 'method' | 'url' | 'headers'>): boolean {
  if (!MUTATING_METHODS.has(req.method ?? '')) return false
  const url = req.url ?? ''
  if (!url.startsWith('/api/')) return false
  if (url.startsWith('/api/test/')) return false
  return req.headers[CSRF_HEADER] !== CSRF_HEADER_VALUE
}
