import type { IncomingMessage } from 'node:http'

import type { WidgetViewer } from '@shared/widgets/contracts'

import { getAccount } from '../auth/accounts'
import type { AuthDeps } from '../auth/handlers'
import { isAuthResult, requireSession } from '../auth/session-guard'
import { WidgetViewerLookupError } from './errors'

/**
 * Three outcomes, deliberately distinct:
 *
 * - `null` — no usable session. The standalone widget harnesses and the e2e
 *   stack run without nginx and therefore without a session cookie, so their
 *   writes are stored unattributed and must keep succeeding.
 * - an error — the session was live but its account could not be read (Valkey
 *   fault, corrupt record, deleted account). The caller must fail the request:
 *   the ledger is append-only, so a record written with `createdBy: null` here
 *   would be silently unattributable forever.
 * - a viewer — the account behind the session.
 */
export async function resolveWidgetViewer(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<WidgetViewerLookupError | WidgetViewer | null> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return null

  const account = await getAccount(deps.ops, session.accountId)
  if (account instanceof Error) {
    return new WidgetViewerLookupError({ accountId: session.accountId, cause: account })
  }

  return { accountId: account.id, name: account.name }
}
