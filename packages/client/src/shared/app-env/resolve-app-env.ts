import * as errore from 'errore'

import { APP_ENVS, type AppEnvName } from './registry'

export class AppEnvError extends errore.createTaggedError({
  name: 'AppEnvError',
  message: 'Unknown APP_ENV "$value". Known environments: $known',
}) {}

const KNOWN_NAMES = Object.keys(APP_ENVS) as AppEnvName[]

export function isAppEnvName(value: string): value is AppEnvName {
  return Object.hasOwn(APP_ENVS, value)
}

/**
 * Absent -> the caller's fallback. Present but unrecognised -> an error.
 *
 * Never a silent fall back to production: a typo anywhere in
 * RPI_ENV -> APP_ENV -> VITE_APP_ENV would otherwise ship a stand that looks
 * exactly like production, which is the confusion this whole feature exists to
 * remove. Returned as a value (errore); the Vite config is the single call
 * site that turns it into a throw, at config load, before any build work.
 */
export function resolveAppEnv(
  raw: string | undefined,
  fallback: AppEnvName,
): AppEnvError | AppEnvName {
  const value = raw?.trim()
  if (!value) return fallback
  if (!isAppEnvName(value)) return new AppEnvError({ value, known: KNOWN_NAMES.join(', ') })
  return value
}
