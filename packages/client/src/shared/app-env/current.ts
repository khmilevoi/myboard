import type { AppEnvName } from './registry'

/**
 * The environment this bundle was built for.
 *
 * Deliberately NOT part of src/env.ts: that module validates import.meta.env
 * at runtime, whereas this name is resolved once at config load and injected
 * through `define`. Having it in both places would create two sources for one
 * fact.
 */
export const currentAppEnv: AppEnvName = __APP_ENV__
