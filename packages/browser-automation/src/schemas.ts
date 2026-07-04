import { z } from 'zod'

export const TaskRequestSchema = z.object({ payload: z.unknown().optional() })
export type TaskRequest = z.infer<typeof TaskRequestSchema>

export const TaskSuccessSchema = z.object({ ok: z.literal(true), result: z.unknown() })
export const TaskErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    meta: z.record(z.string(), z.unknown()).optional(),
  }),
})
export const TaskResponseSchema = z.discriminatedUnion('ok', [TaskSuccessSchema, TaskErrorSchema])
export type TaskResponse = z.infer<typeof TaskResponseSchema>

export const HealthResponseSchema = z.object({
  status: z.enum(['starting', 'ready', 'draining']),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>
