import { describe, expect, it } from 'vitest'

import { CommentsSchema } from './comments'

describe('CommentsSchema', () => {
  it('drops a single malformed element instead of failing the whole array (F2a)', () => {
    const good = {
      id: 'c1',
      ts: 1,
      text: 'hello',
      createdBy: { accountId: 'a1', name: 'Карина' },
    }
    const bad = { id: 'c2', ts: 2, text: 'oops', author: 'NotAPerson' }

    // z.array(CommentSchema).parse([good, bad]) would throw here before the
    // fix, blanking the entire comment thread for one bad record.
    const parsed = CommentsSchema.parse([good, bad])

    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe('c1')
  })
})
