/**
 * CSRF contract: mutating /api requests must carry this header. The name is
 * lowercase — valid verbatim both in Node's `req.headers` (Node lowercases
 * incoming names) and in `Headers.set` (case-insensitive).
 */
export const CSRF_HEADER = 'x-requested-with'
export const CSRF_HEADER_VALUE = 'MyBoard'
