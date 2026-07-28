import { safeParse } from '@shared/json'
import * as errore from 'errore'
import { z } from 'zod'

import type { ValkeyOps } from '../storage/valkey'

export class CronStateError extends errore.createTaggedError({
  name: 'CronStateError',
  message: 'Cron state $operation failed for $key',
}) {}

const CronStateSchema = z.object({
  cursorMs: z.number(),
  failures: z.number().int().nonnegative(),
})

export type CronState = z.infer<typeof CronStateSchema>

/**
 * Its own root namespace, not under `w:t:` — otherwise scheduler bookkeeping
 * would show up in widget storage listings and SSE fanout.
 */
export function cronStateKey(typeId: string, jobName: string): string {
  return `cron:${typeId}:${jobName}`
}

export async function readCronState(
  ops: ValkeyOps,
  typeId: string,
  jobName: string,
): Promise<Error | CronState | null> {
  const key = cronStateKey(typeId, jobName)
  const raw = await ops
    .get(key)
    .catch((cause) => new CronStateError({ operation: 'get', key, cause }))
  if (raw instanceof Error) return raw
  if (raw === null) return null

  const parsed = safeParse(raw)
  if (parsed instanceof Error) return new CronStateError({ operation: 'parse', key, cause: parsed })

  const validated = CronStateSchema.safeParse(parsed)
  if (!validated.success) {
    return new CronStateError({ operation: 'validate', key, cause: validated.error })
  }
  return validated.data
}

export async function writeCronState(
  ops: ValkeyOps,
  typeId: string,
  jobName: string,
  state: CronState,
): Promise<Error | void> {
  const key = cronStateKey(typeId, jobName)
  const written = await ops
    .set(key, JSON.stringify(state))
    .catch((cause) => new CronStateError({ operation: 'set', key, cause }))
  if (written instanceof Error) return written
}
