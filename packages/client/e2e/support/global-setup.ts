import { execSync } from 'node:child_process'
import { resolve } from 'node:path'

/**
 * Builds what every worker's stack serves, once, before any worker starts:
 * the test-server bundle and the production client build (host + widget
 * remotes). Set E2E_SKIP_BUILD=1 to reuse an existing build while iterating
 * on specs.
 */
export default function globalSetup(): void {
  if (process.env['E2E_SKIP_BUILD'] === '1') return
  const root = resolve(import.meta.dirname, '..', '..', '..', '..')
  execSync('pnpm --filter server build && pnpm build', { cwd: root, stdio: 'inherit' })
}
