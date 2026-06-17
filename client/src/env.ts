import * as errore from 'errore'
import { z } from 'zod'

export class EnvError extends errore.createTaggedError({
  name: 'EnvError',
  message: 'Invalid environment: $reason',
}) {}

const envSchema = z.object({
  MODE: z.string().default('production'),
  DEV: z.boolean().default(false),
  PROD: z.boolean().default(true),
  // Host↔widget handshake timeout (ms). Env vars are strings, so coerce.
  VITE_WIDGET_HANDSHAKE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
})

export type Env = z.infer<typeof envSchema>

/** Validate a raw env object. Testable boundary — returns the error as a value. */
export function parseEnv(raw: unknown): EnvError | Env {
  const result = envSchema.safeParse(raw)
  if (!result.success) return new EnvError({ reason: result.error.message })
  return result.data
}

/**
 * Validated env, resolved once at module load. Invalid configuration is an
 * unrecoverable startup error, so this is the one place we fail fast (throw).
 */
export const env: Env = (() => {
  const parsed = parseEnv(import.meta.env)
  if (parsed instanceof Error) throw parsed
  return parsed
})()
