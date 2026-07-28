import { action, atom, computed, withAsyncData, withChangeHook, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { withStorageKeyReadonly, type WidgetIdentity, type WidgetStorage } from 'widget-runtime'

import { resolveEntryAuthor, type EntryAuthor } from '@/domain/author'
import { commentsKey, CommentsSchema } from '@/domain/comments'
import type { Comment } from '@/domain/comments'
import type { OfeliaEvents } from '@/domain/events'
import { weekStartISO } from '@/domain/roster'

export type CommentView = {
  id: string
  text: string
  author: EntryAuthor
  createdAt: number
  isViewerComment: boolean
}

export interface OfeliaCommentsModelProps {
  storage: WidgetStorage
  viewWeekStart: AtomLike<Temporal.PlainDate | null>
  api: WidgetApi<OfeliaEvents>
  /** Read by the comment view; the comment itself is stamped server-side. */
  identity: WidgetIdentity
}

export const ofeliaCommentsModel = ({
  storage,
  viewWeekStart,
  api,
  identity,
}: OfeliaCommentsModelProps) => {
  const key = computed(() => {
    const weekStart = viewWeekStart()
    return weekStart ? commentsKey(weekStartISO(weekStart)) : null
  }, 'ofeliaComments.key')

  const comments = atom<Comment[]>([], 'ofeliaComments.comments').extend(
    withStorageKeyReadonly({
      api: storage.shared.server,
      key,
      fallback: [],
      schema: CommentsSchema,
    }),
  )

  // F14: the connect hook's listener only ever writes `comments` on a
  // SUCCESSFUL event — a failed read for the newly viewed week just sets
  // `error` and returns, leaving `comments` holding whatever the PREVIOUS
  // week last resolved to. Unlike `ledger` (whose null sentinel at least
  // gates the UI), `comments` starts at `[]` and can hold real rows from a
  // different week, rendering indistinguishably from the current week's
  // thread.
  const commentsError = comments.error

  // Tracks which key's rows `comments` currently holds. `withStorageKeyReadonly`
  // only ever writes `comments` through `target.set` on a successful event, so a
  // change here always means a fresh, successfully-parsed read landed — record
  // the key it was for. (Two consecutive keys that both resolve to the empty
  // `fallback` array share that exact reference, so the hook can be skipped for
  // one of them; harmless, since `comments()` is `[]` under both keys anyway.)
  const loadedKey = atom<string | null>(null, 'ofeliaComments.loadedKey')
  comments.extend(
    withChangeHook(() => {
      loadedKey.set(key())
    }),
  )

  // The narrow hazard F14 needed to fix: `comments` still holding a DIFFERENT
  // week's rows while a fresh key's first read fails. `loadedKey` matching
  // `key()` means the rows already on hand genuinely belong to the week being
  // viewed, so a *later* failure on that same subscription (a flaky re-poll,
  // an unparsable push) is a transient hiccup, not evidence the visible rows
  // are wrong — keep them and let the caller show a non-destructive banner
  // instead of blanking a thread the reader was already looking at.
  const commentsBlocked = computed(
    () => commentsError() != null && loadedKey() !== key(),
    'ofeliaComments.commentsBlocked',
  )

  // The mirror case: an error is present, but `commentsBlocked` is false
  // because the rows on hand already belong to the viewed week. Rendered as a
  // non-destructive banner alongside the still-visible thread, instead of
  // `commentsBlocked`'s replace-with-nothing treatment. Mutually exclusive
  // with `commentsBlocked` by construction (both read the same `commentsError`
  // and `commentsBlocked` is that condition's exact negation) — pinned by a
  // model test so the two can never drift into being simultaneously true.
  const commentsWarning = computed(
    () => commentsError() != null && !commentsBlocked(),
    'ofeliaComments.commentsWarning',
  )

  const commentThread = computed<CommentView[]>(() => {
    if (commentsBlocked()) return []

    const members = identity.members()
    const viewerAccountId = identity.viewer()?.accountId ?? null

    return comments()
      .toSorted((left, right) => left.ts - right.ts)
      .map((comment) => {
        const author = resolveEntryAuthor(comment.createdBy, comment.author, members)
        return {
          id: comment.id,
          text: comment.text,
          author,
          createdAt: comment.ts,
          isViewerComment:
            author.kind === 'account' &&
            viewerAccountId !== null &&
            author.accountId === viewerAccountId,
        }
      })
  }, 'ofeliaComments.commentThread')

  // The server trims and stamps the authoring account; the empty-text check
  // here only avoids a pointless round trip. Both reactive reads happen before
  // the first `await` so they resolve against this widget's context.
  const send = action(async (text: string) => {
    const week = viewWeekStart()
    if (week == null) return
    if (text.trim().length === 0) return

    const result = await wrap(api.invoke('comment', { weekStart: weekStartISO(week), text }))
    if (result instanceof Error) throw result
  }, 'ofeliaComments.send').extend(withAsyncData({ status: true }))

  return {
    comments,
    commentsError,
    commentsBlocked,
    commentsWarning,
    commentThread,
    send,
  }
}
