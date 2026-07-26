import { action, atom, computed, withAsyncData, wrap } from '@reatom/core'
import type { AtomLike } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { withStorageKeyReadonly, type WidgetIdentity, type WidgetStorage } from 'widget-runtime'

import { commentsKey, CommentsSchema } from '@/domain/comments'
import type { Comment } from '@/domain/comments'
import type { OfeliaEvents } from '@/domain/events'
import { weekStartISO } from '@/domain/roster'
import type { Person } from '@/domain/roster'

import { formatDateShort } from '../ui/format'

export type CommentView = {
  id: string
  /** LEGACY pre-account signature; absent on account-authored comments. */
  author?: Person
  authorName: string
  date: string
  text: string
}

export interface OfeliaCommentsModelProps {
  storage: WidgetStorage
  viewWeekStart: AtomLike<Temporal.PlainDate | null>
  api: WidgetApi<OfeliaEvents>
  /** Read by the comment view; the comment itself is stamped server-side. */
  identity: WidgetIdentity
}

export const ofeliaCommentsModel = ({ storage, viewWeekStart, api }: OfeliaCommentsModelProps) => {
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

  const commentThread = computed<CommentView[]>(
    () =>
      comments()
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map((comment) => ({
          id: comment.id,
          ...(comment.author ? { author: comment.author } : {}),
          authorName: comment.createdBy?.name ?? comment.author ?? '',
          date: formatDateShort(comment.ts),
          text: comment.text,
        })),
    'ofeliaComments.commentThread',
  )

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
