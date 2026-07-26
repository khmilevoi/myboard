import { z } from 'zod'

import { CreatedBySchema } from './ledger'
import { PersonSchema } from './roster'

export const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  text: z.string(),
  createdBy: CreatedBySchema.nullish(),
  author: PersonSchema.optional().describe('LEGACY pre-account signature. Read-only'),
})

export const CommentsSchema = z.array(CommentSchema)
export type Comment = z.infer<typeof CommentSchema>
export type CommentDraft = Omit<Comment, 'id' | 'ts' | 'author'>

/**
 * `weekStartIso` MUST be the output of `weekStartISO(date)`. The produced key is
 * a persistence contract — it is byte-identical to the previous
 * `comments:${weekStartISO(date)}`.
 */
export function commentsKey(weekStartIso: string): string {
  return `comments:${weekStartIso}`
}
