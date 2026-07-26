import { action, atom, computed, withAsyncData, wrap } from '@reatom/core'
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
  const comments = atom<Comment[]>([], 'ofeliaComments.comments').extend(
    withStorageKeyReadonly({
      api: storage.shared.server,
      key: computed(() => {
        const weekStart = viewWeekStart()
        return weekStart ? commentsKey(weekStartISO(weekStart)) : null
      }),
      fallback: [],
      schema: CommentsSchema,
    }),
  )

  const commentThread = computed<CommentView[]>(() => {
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
    commentThread,
    send,
  }
}
