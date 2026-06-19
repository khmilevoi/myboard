import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseValue } from './validate'
import { StorageError } from './types'

describe('parseValue', () => {
  it('returns the value unchanged when no schema is given', () => {
    expect(parseValue(undefined, { a: 1 })).toEqual({ a: 1 })
  })

  it('returns parsed data when the schema matches', () => {
    const schema = z.object({ a: z.number() })
    expect(parseValue(schema, { a: 1 })).toEqual({ a: 1 })
  })

  it('returns a StorageError when the schema does not match', () => {
    const schema = z.object({ a: z.number() })
    const result = parseValue(schema, { a: 'nope' })
    expect(result).toBeInstanceOf(StorageError)
  })
})
