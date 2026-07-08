import type { TestControls } from './app'
import type { ValkeyOps } from './storage/valkey'

/**
 * Test mode for the production entry: enabled only by ALLOW_TEST_DB_RESET=1
 * (the same guard the dedicated test-server uses). Gives the dockerized nginx
 * e2e suite time control, reset, and the /api/test seeding routes.
 */
export function makeTestControls(ops: ValkeyOps): {
  now: () => number
  controls: TestControls
} {
  let offset = 0
  return {
    now: () => Date.now() + offset,
    controls: {
      setNow: (ms) => {
        offset = ms - Date.now()
      },
      reset: async () => {
        const keys = await ops.scanKeys('')
        for (const key of keys) await ops.del(key)
      },
    },
  }
}
