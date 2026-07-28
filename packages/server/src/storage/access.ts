/**
 * Storage namespaces the board legitimately owns through the generic
 * `/api/storage` routes: widget instance/shared scopes (`w:i:`/`w:t:`, see
 * packages/shared/storage/scope.ts) and the board's own root scope (`root:`,
 * see packages/client/src/board/storage.ts).
 *
 * Everything else lives in the same flat Valkey keyspace but must never be
 * reachable through this generic surface: auth records (`session:`,
 * `device:`, `account:`, `invite:`, `deviceadd:`, `wachal:`, `pending:`, see
 * packages/server/src/auth/records.ts) and cron scheduler bookkeeping
 * (`cron:`, see packages/server/src/widgets/cron-state.ts). Most critically,
 * `session:<id>` is keyed by the literal session cookie value, so an
 * unguarded prefix listing would hand out every live session token.
 */
export const ALLOWED_STORAGE_NAMESPACES = ['root:', 'w:i:', 'w:t:'] as const

export function isAllowedStorageKey(key: string): boolean {
  return ALLOWED_STORAGE_NAMESPACES.some((namespace) => key.startsWith(namespace))
}

/**
 * A prefix query must already be inside an allowed namespace, not merely
 * overlap with one. A strict prefix of a namespace (e.g. '', 's', or 'w:')
 * would let `scanKeys` enumerate keys outside the allowlist, including live
 * session tokens.
 */
export function isAllowedStoragePrefix(prefix: string): boolean {
  return ALLOWED_STORAGE_NAMESPACES.some((namespace) => prefix.startsWith(namespace))
}
