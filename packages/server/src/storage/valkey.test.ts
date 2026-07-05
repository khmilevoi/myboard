import { describe, expect, it } from 'vitest'

import { createValkeyTestOps } from './valkey'

// Real Valkey tests are opt-in: they need a reachable Valkey instance. Run
// with VALKEY_IT=1 (and VALKEY_URL if not the default) once one is up, e.g.
// via `pnpm docker:up` or `docker run --rm -p 6379:6379 valkey/valkey:8-alpine`.
const run = process.env['VALKEY_IT'] === '1'

describe.skipIf(!run)('createValkeyTestOps (real Valkey)', () => {
  it('round-trips set/get and removes on del', async () => {
    const ops = createValkeyTestOps()
    await ops.set('valkey-test:k', '1')
    expect(await ops.get('valkey-test:k')).toBe('1')
    await ops.del('valkey-test:k')
    expect(await ops.get('valkey-test:k')).toBeNull()
  })

  it('clear() empties the whole database', async () => {
    const ops = createValkeyTestOps()
    await ops.set('valkey-test:a', 'x')
    await ops.set('valkey-test:b', 'y')
    await ops.clear()
    expect(await ops.scanKeys('valkey-test:')).toEqual([])
  })
})
