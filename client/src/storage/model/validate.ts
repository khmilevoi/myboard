import type { z } from 'zod'
import { StorageError } from './types'

/** Validate a raw value against an optional schema. No schema = bare typed cast. */
export function parseValue<T>(schema: z.ZodType<T> | undefined, value: unknown): StorageError | T {
  if (!schema) return value as T
  const parsed = schema.safeParse(value)
  if (!parsed.success) return new StorageError({ reason: 'schema validation failed', cause: parsed.error })
  return parsed.data
}
