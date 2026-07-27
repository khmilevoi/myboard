import type { AppEnvName } from './shared/app-env/registry'

declare global {
  /**
   * Injected by `define` in vite.config.ts and vite.activation.config.ts.
   * A build constant, not a runtime value -- there is no runtime environment
   * switching, by design.
   */
  const __APP_ENV__: AppEnvName
}
