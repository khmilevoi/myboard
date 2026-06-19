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
    errors: err.issues.map((issue: ZodError['issues'][number]) => ({
      path: issue.path.map((part) => (typeof part === 'symbol' ? part.description ?? part.toString() : part)),
      message: issue.message,
    })),
  }
}

export const EventsBodySchema = z.object({
  subscribe: z.array(z.string()).optional(),
  unsubscribe: z.array(z.string()).optional(),
})

export type EventsBody = z.infer<typeof EventsBodySchema>

export const StorageEventSchema = z.object({
  key: z.string(),
  value: z.unknown(),
})

export type StorageEvent = z.infer<typeof StorageEventSchema>

export const EventsParamsSchema = z.object({
  connId: z.string(),
})
