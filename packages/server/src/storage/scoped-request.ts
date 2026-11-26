import type { IncomingMessage } from 'node:http'

import { EXPECTED_ACCOUNT_HEADER, type ScopedBranch } from '@shared/storage/scoped'

import type { AuthDeps } from '../auth/handlers'
import type { SessionRecord } from '../auth/records'
import { isAuthResult, requireSession } from '../auth/session-guard'
import {
  ScopedAccountMismatchError,
  ScopedRouteUnknownError,
  ScopedSessionRequiredError,
  resolveScopedNamespace,
  type ScopedOwners,
  type ScopedStorageError,
} from './scoped'

export type RouteParams = Record<string, string | undefined>

// URL segments are untrusted strings; narrow them at runtime, never by type.
export function parseScopedBranch(params: RouteParams): ScopedBranch | null {
  const { owner, id, scope } = params
  if (owner !== 'widget' && owner !== 'module') return null
  if (scope !== 'shared' && scope !== 'account') return null
  if (id === undefined || id === '') return null
  return { owner, id, scope }
}

export type ResolvedScopedRequest = {
  branch: ScopedBranch
  namespace: string
  /** The verified session when the branch needed one (account scope), else null. */
  session: SessionRecord | null
}

/**
 * The branch and namespace of a scoped request. The session is only read for account scope, after
 * the owner/scope checks, so module/shared works without one and an undeclared scope answers 403
 * before 401. An account request whose `EXPECTED_ACCOUNT_HEADER` names another account than the
 * session's is refused with 409 instead of landing in the session account's namespace.
 */
export async function resolveScopedRequest(options: {
  authDeps: AuthDeps
  owners: ScopedOwners
  req: IncomingMessage
  params: RouteParams
}): Promise<ScopedStorageError | ResolvedScopedRequest> {
  const { authDeps, owners, req, params } = options
  const branch = parseScopedBranch(params)
  if (branch === null) {
    return new ScopedRouteUnknownError({ owner: params.owner ?? '', scope: params.scope ?? '' })
  }
  const first = resolveScopedNamespace({ owners, branch, accountId: null })
  if (!(first instanceof Error)) return { branch, namespace: first, session: null }
  if (!(first instanceof ScopedSessionRequiredError)) return first

  const session = await requireSession(authDeps, req)
  if (isAuthResult(session)) return first
  const expected = req.headers[EXPECTED_ACCOUNT_HEADER]
  if (typeof expected === 'string' && expected !== session.accountId) {
    return new ScopedAccountMismatchError()
  }
  const namespace = resolveScopedNamespace({ owners, branch, accountId: session.accountId })
  if (namespace instanceof Error) return namespace
  return { branch, namespace, session }
}
