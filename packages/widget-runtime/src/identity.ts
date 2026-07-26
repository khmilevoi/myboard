import { atom, computed, withConnectHook, wrap, type Computed } from '@reatom/core'
import type { HttpLike } from '@shared/http/client'
import * as errore from 'errore'
import { z } from 'zod'

export type BoardMember = { accountId: string; name: string; avatarUrl?: string }

export type WidgetIdentity = {
  /** The account this document is signed in as; null before the roster loads and in unauthenticated hosts. */
  viewer: Computed<BoardMember | null>
  /** Every account on the board, by id. Empty before the roster loads. */
  members: Computed<ReadonlyMap<string, BoardMember>>
}

export class BoardMembersError extends errore.createTaggedError({
  name: 'BoardMembersError',
  message: 'Could not load the board members directory',
}) {}

const AccountsResultSchema = z.object({
  accounts: z.array(
    z.object({
      accountId: z.string(),
      name: z.string(),
      avatarUrl: z.string().optional(),
    }),
  ),
  viewerAccountId: z.string(),
})

type IdentityState = {
  members: ReadonlyMap<string, BoardMember>
  viewerAccountId: string
}

const EMPTY: ReadonlyMap<string, BoardMember> = new Map()

async function fetchIdentity(http: HttpLike): Promise<BoardMembersError | IdentityState> {
  const response = await http.get('/api/auth/accounts')
  if (response instanceof Error) return new BoardMembersError({ cause: response })
  if (!response.ok) return new BoardMembersError()

  const parsed = AccountsResultSchema.safeParse(response.body)
  if (!parsed.success) return new BoardMembersError({ cause: parsed.error })

  return {
    members: new Map(parsed.data.accounts.map((member) => [member.accountId, member])),
    viewerAccountId: parsed.data.viewerAccountId,
  }
}

export type MakeWidgetIdentityOptions = { http: HttpLike }

/**
 * One directory per document. The fetch is deferred to the first subscriber via
 * withConnectHook, so a harness or a board with no identity-reading widget
 * never calls the endpoint. `wrap` is called fresh inside the hook on purpose —
 * a hoisted wrapped closure aborts after `context.reset()`.
 */
export function makeWidgetIdentity({ http }: MakeWidgetIdentityOptions): WidgetIdentity {
  const state = atom<IdentityState | null>(null, 'identity.state').extend(
    withConnectHook(() => {
      void wrap(fetchIdentity(http)).then((result) => {
        if (result instanceof Error) return
        state.set(result)
      })
    }),
  )

  return buildIdentity(state)
}

export type MakeStaticWidgetIdentityOptions = {
  members?: BoardMember[]
  viewerAccountId?: string
}

/** Test and harness double: no request, no connect hook. */
export function makeStaticWidgetIdentity({
  members = [],
  viewerAccountId = '',
}: MakeStaticWidgetIdentityOptions = {}): WidgetIdentity {
  const state = atom<IdentityState | null>(
    { members: new Map(members.map((member) => [member.accountId, member])), viewerAccountId },
    'identity.staticState',
  )

  return buildIdentity(state)
}

function buildIdentity(state: { (): IdentityState | null }): WidgetIdentity {
  const members = computed(() => state()?.members ?? EMPTY, 'identity.members')
  const viewer = computed(() => {
    const current = state()
    if (!current) return null
    return current.members.get(current.viewerAccountId) ?? null
  }, 'identity.viewer')

  return { members, viewer }
}
