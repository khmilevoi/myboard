import { BrowserAutomationUnavailableError } from '@shared/widgets/browser-errors'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { makeRecoveryCapabilityStore } from './capability'
import { recoveryCookieName, serializeRecoveryCookie } from './cookie'
import { handleRecoveryIssue } from './handlers'

function makeDeps(overrides?: { secureCookies?: boolean }) {
  const fake = makeFakeBrowserAutomationClient()
  const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
  return {
    fake,
    store,
    deps: {
      store,
      client: fake.client,
      secureCookies: overrides?.secureCookies ?? true,
      tokenTtlMs: 60_000,
    },
  }
}

describe('recovery cookie', () => {
  it('uses the __Secure- prefix only on a secure origin', () => {
    expect(recoveryCookieName(true)).toBe('__Secure-mb_recovery')
    expect(recoveryCookieName(false)).toBe('mb_recovery')
  })

  it('scopes the cookie to the recovery path', () => {
    const secure = serializeRecoveryCookie({ token: 'tok', ttlMs: 60_000, secureCookies: true })

    expect(secure).toContain('__Secure-mb_recovery=tok')
    expect(secure).toContain('Path=/api/browser/recovery')
    expect(secure).toContain('Max-Age=60')
    expect(secure).toContain('HttpOnly')
    expect(secure).toContain('Secure')
    expect(secure).toContain('SameSite=Strict')

    const insecure = serializeRecoveryCookie({ token: 'tok', ttlMs: 60_000, secureCookies: false })
    expect(insecure).toContain('mb_recovery=tok')
    expect(insecure).not.toContain('Secure')
  })
})

describe('handleRecoveryIssue', () => {
  it('issues a capability when a retained page exists', async () => {
    const { deps, fake } = makeDeps()
    fake.setRecoveryState({ retained: true })

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ expiresInMs: 60_000 })
    expect(result.cookie).toContain('__Secure-mb_recovery=')
    expect(fake.recoveryCalls).toEqual(['passport-checker'])
  })

  it('reports nothing to recover when no page is retained', async () => {
    const { deps, fake } = makeDeps()
    fake.setRecoveryState({ retained: false })

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 404, body: { code: 'recovery_unavailable' } })
  })

  it('rejects an unsafe widget id without calling the service', async () => {
    const { deps, fake } = makeDeps()

    const result = await handleRecoveryIssue(deps, {
      widgetId: '../../etc/passwd',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 404, body: { code: 'recovery_unavailable' } })
    expect(fake.recoveryCalls).toEqual([])
  })

  it('refuses while a recovery session is already active', async () => {
    const { deps, store, fake } = makeDeps()
    fake.setRecoveryState({ retained: true })
    store.attach({ widgetId: 'passport-checker', destroy: () => {} })

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 409, body: { code: 'recovery_busy' } })
    expect(fake.recoveryCalls).toEqual([])
  })

  it('maps an unreachable automation service to 503', async () => {
    const { deps, fake } = makeDeps()
    fake.setRecoveryState(new BrowserAutomationUnavailableError({ operation: 'fetch' }))

    const result = await handleRecoveryIssue(deps, {
      widgetId: 'passport-checker',
      sessionId: 's-1',
    })

    expect(result).toEqual({ status: 503, body: { code: 'automation_unavailable' } })
  })
})
