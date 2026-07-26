import { z } from 'zod'

import { PersonSchema } from './roster'

export const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  ip: z.string().optional(),
  author: PersonSchema,
  text: z.string(),
})

export const CommentsSchema = z.array(CommentSchema)
export type Comment = z.infer<typeof CommentSchema>

/**
 * `weekStartIso` MUST be the output of `weekStartISO(date)`. The produced key is
 * a persistence contract — it is byte-identical to the previous
 * `comments:${weekStartISO(date)}`.
 */
export function commentsKey(weekStartIso: string): string {
  return `comments:${weekStartIso}`
}
