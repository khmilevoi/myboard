import { atom, computed, withChangeHook } from '@reatom/core'
import type { Atom, AtomLike, Computed } from '@reatom/core'
import { withStorageKeyReadonly, type StorageError } from 'widget-runtime'
import type { ScopedStorage, WidgetIdentity } from 'widget-runtime'

import { resolveEntryAuthor, type EntryAuthor } from '../domain/author'
import { CommentsSchema, type Comment } from '../domain/comments'
import { commentsKey } from '../domain/keys'
import { weekStartISO } from '../domain/roster'

export type CommentView = {
  id: string
  text: string
  author: EntryAuthor
  createdAt: number
  isViewerComment: boolean
}

export type LitterWeekComments = {
  comments: Atom<Comment[]>
  /** The last failed read of the viewed week's comments, or null. */
  commentsError: Atom<StorageError | null>
  commentsBlocked: Computed<boolean>
  commentsWarning: Computed<boolean>
  commentThread: Computed<CommentView[]>
}

export type MakeWeekCommentsOptions = {
  storage: ScopedStorage
  identity: WidgetIdentity
  /** The litter whose comment threads this view reads. */
  litterId: string
  weekStart: AtomLike<Temporal.PlainDate | null>
}

/**
 * One comment-thread view over the week `weekStart` points at. Every call builds
 * its own atoms, so two views on different weeks never share a subscription.
 */
export function makeWeekComments({
  storage,
  identity,
  litterId,
  weekStart,
}: MakeWeekCommentsOptions): LitterWeekComments {
  const name = (suffix: string) => `cats.litter.${litterId}.weekComments.${suffix}`

  const key = computed(() => {
    const week = weekStart()
    return week ? commentsKey(litterId, weekStartISO(week)) : null
  }, name('key'))

  const comments = atom<Comment[]>([], name('comments')).extend(
    withStorageKeyReadonly({
      api: storage.server,
      key,
      fallback: [],
      schema: CommentsSchema,
    }),
  )

  // F14: the connect hook's listener only ever writes `comments` on a
  // SUCCESSFUL event — a failed read for the newly viewed week just sets
  // `error` and returns, leaving `comments` holding whatever the PREVIOUS
  // week last resolved to. `comments` starts at `[]` and can hold real rows
  // from a different week, rendering indistinguishably from the current
  // week's thread.
  const commentsError = comments.error

  // Tracks which key's rows `comments` currently holds. `withStorageKeyReadonly`
  // only ever writes `comments` through `target.set` on a successful event, so a
  // change here always means a fresh, successfully-parsed read landed — record
  // the key it was for. (Two consecutive keys that both resolve to the empty
  // `fallback` array share that exact reference, so the hook can be skipped for
  // one of them; harmless, since `comments()` is `[]` under both keys anyway.)
  const loadedKey = atom<string | null>(null, name('loadedKey'))
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
    name('commentsBlocked'),
  )

  // The mirror case: an error is present, but `commentsBlocked` is false
  // because the rows on hand already belong to the viewed week. Mutually
  // exclusive with `commentsBlocked` by construction.
  const commentsWarning = computed(
    () => commentsError() != null && !commentsBlocked(),
    name('commentsWarning'),
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
  }, name('commentThread'))

  return { comments, commentsError, commentsBlocked, commentsWarning, commentThread }
}
