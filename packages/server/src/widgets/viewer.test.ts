import { describe, expect, it } from 'vitest'

import type { AuthDeps } from '../auth/handlers'
import { accountKey } from '../auth/records'
import { fakeReq, makeClock, makeConfig, makeOps, seedSessionCookie } from '../test/auth-fixtures'
import { WidgetViewerLookupError } from './errors'
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

  it('fails instead of falling back to null when the account record is unreadable', async () => {
    const { ops, clock, config, deps } = makeDeps()
    const { account, req } = await seedSessionCookie(ops, config, clock.now)
    await ops.set(accountKey(account.id), 'not json')

    const viewer = await resolveWidgetViewer(deps, req)

    expect(viewer).toBeInstanceOf(WidgetViewerLookupError)
    expect((viewer as WidgetViewerLookupError).accountId).toBe(account.id)
  })

  it('fails when the session points at an account that no longer exists', async () => {
    const { ops, clock, config, deps } = makeDeps()
    const { account, req } = await seedSessionCookie(ops, config, clock.now)
    await ops.del(accountKey(account.id))

    expect(await resolveWidgetViewer(deps, req)).toBeInstanceOf(WidgetViewerLookupError)
  })
})
