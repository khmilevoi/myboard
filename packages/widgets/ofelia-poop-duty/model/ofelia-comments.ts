import {
  addChangeHook,
  action,
  atom,
  computed,
  withAsyncData,
  withConnectHook,
  wrap,
} from '@reatom/core'
import type { Atom, AtomLike } from '@reatom/core'
import { withStorageKeyReadonly, type WidgetStorage } from 'widget-runtime'
import z from 'zod'

import { formatDateShort } from '../ui/format'
import { DUTY_ROTATION, IP_TAIL_LENGTH, weekStartISO } from './ofelia-duty'
import type { Person } from './ofelia-duty'

const AuthorSchema = z.enum(DUTY_ROTATION)

const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string().optional(),
  author: AuthorSchema,
  text: z.string(),
})

const CommentsSchema = z.array(CommentSchema)

export type Comment = z.infer<typeof CommentSchema>

export type CommentDraft = Pick<Comment, 'author' | 'text'>

export type CommentView = {
  id: string
  author: Person
  authorName: string
  date: string
  ipTail: string
  text: string
}

export function commentsKey(date: Temporal.PlainDate): string {
  return `comments:${weekStartISO(date)}`
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
        return weekStart ? commentsKey(weekStart) : null
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
      storage.shared.server.append(commentsKey(week), {
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
