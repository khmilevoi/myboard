import type { IncomingMessage } from 'node:http'

import type { WidgetViewer } from '@shared/widgets/contracts'

import { getAccount } from '../auth/accounts'
import type { AuthDeps } from '../auth/handlers'
import { isAuthResult, requireSession } from '../auth/session-guard'

export async function resolveWidgetViewer(
  deps: AuthDeps,
  req: IncomingMessage,
): Promise<WidgetViewer | null> {
  const session = await requireSession(deps, req)
  if (isAuthResult(session)) return null

  const account = await getAccount(deps.ops, session.accountId)
  if (account instanceof Error) return null

  return { accountId: account.id, name: account.name }
}
