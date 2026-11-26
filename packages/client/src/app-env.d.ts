import type { AppBuildInfo } from './shared/app-env/build-info'
import type { AppEnvName } from './shared/app-env/registry'

declare global {
  /**
   * Injected by `define` in vite.config.ts and vite.activation.config.ts.
   * A build constant, not a runtime value -- there is no runtime environment
   * switching, by design.
   */
  const __APP_ENV__: AppEnvName
  /**
   * Injected by `define` in vite.config.ts only: the branch and commit a stand
   * was built from (`RPI_BRANCH_NAME` / `RPI_COMMIT_SHA` -> Docker build args
   * -> `VITE_APP_BRANCH` / `VITE_APP_COMMIT`). The activation app does not
   * render the env badge, so it does not define this.
   */
  const __APP_BUILD__: AppBuildInfo
}
