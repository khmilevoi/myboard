import { z } from 'zod'

import { CreatedBySchema } from './ledger'
import { PersonSchema } from './roster'

export const CommentSchema = z.object({
  id: z.string(),
  ts: z.number(),
  text: z.string(),
  createdBy: CreatedBySchema.nullish(),
  author: PersonSchema.optional().describe(
    'LEGACY pre-account signature. F2a: written again for one release as a ' +
      'compat shim so pre-release (main) clients, which require this field ' +
      'and reject the whole thread without it, can still read new comments. ' +
      'Drop the write side once no main-era bundle can be live.',
  ),
})

// A single malformed element must not blank the whole thread for everyone:
// parse per element and drop what doesn't validate instead of failing the
// array wholesale.
export const CommentsSchema = z.array(z.unknown()).transform((rawComments) =>
  rawComments.flatMap((raw) => {
    const parsed = CommentSchema.safeParse(raw)
    if (!parsed.success) {
      console.warn('Dropping malformed comment', parsed.error)
      return []
    }
    return [parsed.data]
  }),
)
export type Comment = z.infer<typeof CommentSchema>
// `author` stays part of the draft shape (not omitted) only for the
// one-release compat shim above — see makeCommentDraft in drafts.ts.
export type CommentDraft = Omit<Comment, 'id' | 'ts'>

/**
 * `weekStartIso` MUST be the output of `weekStartISO(date)`. The produced key is
 * a persistence contract — it is byte-identical to the previous
 * `comments:${weekStartISO(date)}`.
 */
export function commentsKey(weekStartIso: string): string {
  return `comments:${weekStartIso}`
}
