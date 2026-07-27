import * as errore from 'errore'
import { z } from 'zod'

export type BrowserServiceConfig = {
  port: number
  queueWaitMs: number
  executionMs: number
  profileDir: string
  secretsDir: string
  recoverySshTarget: string | null
  novncPort: number
}

export class BrowserServiceConfigError extends errore.createTaggedError({
  name: 'BrowserServiceConfigError',
  message: 'Invalid browser service configuration: $reason',
}) {}

// Preprocess intercepts unset/empty env vars before coercion (Number('') === 0
// would otherwise fail .positive()), preserving the "unset -> default" behaviour.
const positiveIntEnv = (fallback: number) =>
  z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().positive(),
  )

const stringEnv = (fallback: string) =>
  z.preprocess((value) => (value === undefined || value === '' ? fallback : value), z.string())

const ConfigSchema = z.object({
  PORT: positiveIntEnv(8788),
  BROWSER_QUEUE_WAIT_MS: positiveIntEnv(30_000),
  BROWSER_TASK_TIMEOUT_MS: positiveIntEnv(60_000),
  BROWSER_PROFILE_DIR: stringEnv('/profile'),
  BROWSER_SECRETS_DIR: stringEnv('/run/secrets'),
  // Host-published noVNC port, so the recovery hint matches the stack an
  // operator is actually on. Must stay in lockstep with the NOVNC_HOST_PORT
  // that docker-compose.yml already uses for the publish line: the container
  // only ever sees its own internal 6080 and cannot introspect the host bind.
  NOVNC_HOST_PORT: positiveIntEnv(6080),
})

// Public recovery metadata surfaced to the UI, so only a bare host or user@host
// may pass. Deliberately NOT part of ConfigSchema: a parse failure there reaches
// process.exit(1) in index.ts, and an unusable value must only cost the SSH
// fallback hint, never the whole automation service.
const sshTargetPattern = /^(?:[A-Za-z0-9._-]+@)?[A-Za-z0-9.-]+$/

function normalizeRecoverySshTarget(value: string | undefined) {
  const target = value?.trim()
  if (!target) return null
  return sshTargetPattern.test(target) ? target : null
}

export function loadBrowserServiceConfig(
  env: NodeJS.ProcessEnv,
): BrowserServiceConfigError | BrowserServiceConfig {
  const parsed = ConfigSchema.safeParse(env)
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join('.') ?? 'configuration'
    return new BrowserServiceConfigError({ reason: `${field} must be a positive integer` })
  }
  return {
    port: parsed.data.PORT,
    queueWaitMs: parsed.data.BROWSER_QUEUE_WAIT_MS,
    executionMs: parsed.data.BROWSER_TASK_TIMEOUT_MS,
    profileDir: parsed.data.BROWSER_PROFILE_DIR,
    secretsDir: parsed.data.BROWSER_SECRETS_DIR,
    recoverySshTarget: normalizeRecoverySshTarget(env.AUTOMATION_SSH_TARGET),
    novncPort: parsed.data.NOVNC_HOST_PORT,
  }
}
