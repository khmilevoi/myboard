import { action, atom, computed, withAsyncData, wrap } from '@reatom/core'
import type { Atom, AtomLike } from '@reatom/core'
import { withStorageKeyReadonly, type WidgetStorage } from 'widget-runtime'

import { commentsKey, CommentsSchema } from '@/domain/comments'
import type { Comment } from '@/domain/comments'
import { weekStartISO } from '@/domain/roster'
import type { Person } from '@/domain/roster'

import { formatDateShort } from '../ui/format'
import { IP_TAIL_LENGTH } from './ofelia-duty'

export type CommentDraft = Pick<Comment, 'author' | 'text'>

export type CommentView = {
  id: string
  author: Person
  authorName: string
  date: string
  ipTail: string
  text: string
}

export interface OfeliaCommentsModelProps {
  storage: WidgetStorage
  viewWeekStart: AtomLike<Temporal.PlainDate | null>
  currentUser: Atom<Person>
}

export const ofeliaCommentsModel = ({
  storage,
  viewWeekStart,
  currentUser,
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

  const commentThread = computed<CommentView[]>(
    () =>
      comments()
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map((comment) => ({
          id: comment.id,
          author: comment.author,
          authorName: comment.author,
          date: formatDateShort(comment.ts),
          ipTail: comment.ip?.slice(-IP_TAIL_LENGTH) ?? '',
          text: comment.text,
        })),
    'ofeliaComments.commentThread',
  )

  const send = action(async (text: string) => {
    const week = viewWeekStart()
    if (week == null) return

    const trimmed = text.trim()
    if (trimmed.length === 0) return

    const result = await wrap(
      storage.shared.server.append(commentsKey(weekStartISO(week)), {
        author: currentUser(),
        text: trimmed,
      } satisfies CommentDraft),
    )
    if (result instanceof Error) throw result
  }, 'ofeliaComments.send').extend(withAsyncData({ status: true }))

  return {
    comments,
    commentThread,
    send,
  }
}
