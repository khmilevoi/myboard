import type { AppBuildInfo } from './build-info'
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

/** The branch and commit this bundle was built from, when the deploy said. */
export const currentBuildInfo: AppBuildInfo = __APP_BUILD__
