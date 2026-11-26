import { describe, expect, it } from 'vitest'

import { EntityIdSchema, OFELIA_ID } from './ids'

describe('EntityIdSchema', () => {
  it.each([OFELIA_ID, 'ofelia', crypto.randomUUID()])('accepts %s', (id) => {
    expect(EntityIdSchema.safeParse(id).success).toBe(true)
  })

  it.each(['', 'Ofelia', 'a/b', 'a:b', 'a'.repeat(65)])('rejects %s', (id) => {
    expect(EntityIdSchema.safeParse(id).success).toBe(false)
  })
})
