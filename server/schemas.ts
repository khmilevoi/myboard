import { z, type ZodError } from 'zod'

export const PutPayloadSchema = z.object({
  value: z.unknown(),
  ttlMs: z.number().int().positive().optional(),
})

export const PrefixQuerySchema = z.object({
  prefix: z.string().optional(),
})

export type PutPayload = z.infer<typeof PutPayloadSchema>

export function formatZodError(err: ZodError): { errors: { path: (string | number)[]; message: string }[] } {
  return {
    errors: err.errors.map((e) => ({ path: e.path, message: e.message })),
  }
}
