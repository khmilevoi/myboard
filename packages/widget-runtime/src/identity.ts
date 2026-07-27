import { atom, computed, sleep, withConnectHook, wrap, type Computed } from '@reatom/core'
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
}) {
  /**
   * HTTP status of the failed response, when the failure came from a non-2xx
   * status. A 401 is the expected shape on an unauthenticated host (a harness,
   * a logged-out session) and is handled silently; anything else — including a
   * missing status (transport failure, schema drift) — is unexpected.
   */
  status?: number
}

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
  if (!response.ok) {
    const error = new BoardMembersError()
    error.status = response.status
    return error
  }

  const parsed = AccountsResultSchema.safeParse(response.body)
  if (!parsed.success) return new BoardMembersError({ cause: parsed.error })

  return {
    members: new Map(parsed.data.accounts.map((member) => [member.accountId, member])),
    viewerAccountId: parsed.data.viewerAccountId,
  }
}

export type MakeWidgetIdentityOptions = { http: HttpLike }

// Backoff between retries after a transient failure (transport error, a non-401
// status, or a response shape AccountsResultSchema no longer matches). The
// Pi's PWA shell is served from the service-worker cache while the server
// container is still starting after a deploy or reboot, so the very first
// fetch on a page load is exactly the one most likely to need this.
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000]

// Once the roster has loaded, keep refreshing on this cadence so an account
// created later still appears in an already-open board without a reload.
// Also the fallback cadence once the bounded backoff above is exhausted, so a
// boot-window failure that outlasts it keeps quietly retrying forever instead
// of giving up or hammering the server.
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

/**
 * One directory per document. The fetch is deferred to the first subscriber via
 * withConnectHook, so a harness or a board with no identity-reading widget
 * never calls the endpoint. The hook body loops via recursive `.then()` calls
 * rather than an `async`/`await` loop on purpose: `withConnectHook` awaits a
 * Promise-returning hook itself (`await wrap(result)`), and when the connect
 * scope aborts mid-await that extra wrapping layer races its own abort against
 * our loop settling and can leave a rejection with nothing attached to it yet
 * — an internal `try`/`catch` around the loop body does not close that window,
 * because `await wrap(...)` already installs its handler before the `catch`
 * ever runs. A plain (non-async) hook never returns a Promise for
 * `withConnectHook` to re-wrap, so every `wrap(...)` call here carries its own
 * explicit `() => {}` rejection handler instead — the same shape as the
 * original one-shot fetch, just re-entered on a delay.
 */
export function makeWidgetIdentity({ http }: MakeWidgetIdentityOptions): WidgetIdentity {
  const state = atom<IdentityState | null>(null, 'identity.state').extend(
    withConnectHook(() => {
      let attempt = 0

      // A rejection here only ever means the connect scope aborted (the last
      // subscriber disconnected) — `wrap(sleep(...))`'s only other outcome is
      // resolving after the delay. Swallow it and simply stop re-entering
      // `step`; anything else would be a bug in `sleep` itself, not something
      // to retry.
      const scheduleNext = (delay: number) => {
        wrap(sleep(delay)).then(step, () => {})
      }

      const step = () => {
        wrap(fetchIdentity(http)).then(
          (result) => {
            if (result instanceof Error) {
              // A 401 is expected on an unauthenticated host: retrying would just
              // repeat the same 401 forever, so stay silent and stop for good.
              if (result.status === 401) return

              // Everything else is unexpected and worth surfacing, and worth
              // retrying. Once the bounded backoff above is exhausted, fall back
              // to the same slow cadence as the post-success refresh below,
              // rather than hammering a server that has been down for a while.
              console.warn('[widget-runtime]', result.message, result)
              const delay =
                attempt < RETRY_DELAYS_MS.length ? RETRY_DELAYS_MS[attempt] : REFRESH_INTERVAL_MS
              attempt += 1
              scheduleNext(delay)
              return
            }

            state.set(result)
            attempt = 0
            scheduleNext(REFRESH_INTERVAL_MS)
          },
          () => {},
        ) // connect scope aborted mid-fetch — expected, not a failure
      }

      step()
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
