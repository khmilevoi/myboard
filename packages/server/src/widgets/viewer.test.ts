import { describe, expect, it } from 'vitest'

import type { AuthDeps } from '../auth/handlers'
import { fakeReq, makeClock, makeConfig, makeOps, seedSessionCookie } from '../test/auth-fixtures'
import { resolveWidgetViewer } from './viewer'

function makeDeps() {
  const ops = makeOps()
  const clock = makeClock(0)
  const config = makeConfig()
  const deps: AuthDeps = { ops, config, now: clock.now, audit: () => {} }
  return { ops, clock, config, deps }
}

describe('resolveWidgetViewer', () => {
  it('is null without a session cookie', async () => {
    const { deps } = makeDeps()
    expect(await resolveWidgetViewer(deps, fakeReq(undefined))).toBeNull()
  })

  it('is null when the cookie does not match a live session', async () => {
    const { deps } = makeDeps()
    const req = fakeReq(undefined, { cookie: 'mb_session=nope' })
    expect(await resolveWidgetViewer(deps, req)).toBeNull()
  })

  it('resolves the account behind a live session', async () => {
    const { ops, clock, config, deps } = makeDeps()
    const { account, req } = await seedSessionCookie(ops, config, clock.now, { name: 'Карина' })

    expect(await resolveWidgetViewer(deps, req)).toEqual({
      accountId: account.id,
      name: 'Карина',
    })
  })
})
