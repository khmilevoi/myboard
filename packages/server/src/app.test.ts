import type { AddressInfo } from 'node:net'

import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import { defineWidgetServer, toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { PublicWidgetError } from '@shared/widgets/public-error'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { createApp, type App } from './app'
import { addDeviceToAccount, createAccount } from './auth/accounts'
import type { AuthConfig } from './auth/config'
import { storeDevice } from './auth/devices'
import { lookupInvite } from './auth/invites'
import { accountKey, sessionKey } from './auth/records'
import { issueSession } from './auth/sessions'
import { makeFakeBrowserAutomationClient } from './browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from './test/memory-ops'
import { createWidgetServerRegistry } from './widgets/registry'

const testAuthConfig: AuthConfig = {
  rpID: 'localhost',
  rpName: 'MyBoard',
  expectedOrigin: 'http://localhost',
  sessionCookieName: 'session',
  challengeCookieName: 'chal',
  pendingCookieName: 'pending',
  sessionTtlSlidingMs: 1000,
  sessionTtlAbsoluteMs: 2000,
  secureCookies: false,
  trustCfConnectingIp: false,
}

const DEBTS_KEY = encodeURIComponent('w:t:ofelia-poop-duty:debts')

async function seedAccountWithSession(
  opsArg: ReturnType<typeof createMemoryOps>,
  nowMs: number,
  credentialId: string,
) {
  const account = await createAccount(opsArg, () => nowMs, { name: 'Acc', inviteId: 'inv-1' })
  await storeDevice(opsArg, {
    credentialId,
    publicKey: 'pk',
    signCount: 0,
    label: 'Board device',
    createdAt: nowMs,
    lastSeenAt: nowMs,
    disabled: false,
    accountId: account.id,
    status: 'active',
    addedVia: 'invite',
  })
  await addDeviceToAccount(opsArg, account.id, credentialId, { countsAgainstLimit: false })
  const session = await issueSession(opsArg, testAuthConfig, () => nowMs, {
    accountId: account.id,
    credentialId,
  })
  return { account, session }
}

const browserDeadlineCause = new Error('browser deadline: automation timed out')
const protocolMismatchCause = new Error('browser protocol mismatch')

const browserTasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
})

const testWidget = defineWidgetServer({
  schemas: {
    echo: {
      payload: z.object({ value: z.string() }),
      result: z.object({ echoed: z.string(), instanceId: z.string() }),
    },
    browserEcho: {
      payload: z.object({ value: z.string() }),
      result: z.object({ echoed: z.string() }),
    },
    publicReject: {
      payload: z.object({}),
      result: z.object({ ok: z.boolean() }),
    },
    publicRejectNoMeta: {
      payload: z.object({}),
      result: z.object({ ok: z.boolean() }),
    },
    whoami: {
      payload: z.object({}),
      result: z.object({
        viewer: z.object({ accountId: z.string(), name: z.string() }).nullable(),
      }),
    },
    publicRejectServerCause: {
      payload: z.object({}),
      result: z.object({ ok: z.boolean() }),
    },
    publicRejectClientCause: {
      payload: z.object({}),
      result: z.object({ ok: z.boolean() }),
    },
  },
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
    },
    whoami(_payload, context) {
      return { viewer: context.viewer }
    },
    async browserEcho(payload, context) {
      return context.api.browser.invoke(browserTasks.check, payload)
    },
    publicReject() {
      return new PublicWidgetError({
        status: 409,
        code: 'browser_session_required',
        publicMessage: 'The browser session requires attention',
        meta: { sshTarget: 'admin@pi' },
      })
    },
    publicRejectNoMeta() {
      return new PublicWidgetError({
        code: 'browser_configuration',
        publicMessage: 'Passport checker is not configured',
        status: 500,
      })
    },
    publicRejectServerCause() {
      return new PublicWidgetError({
        code: 'browser_unavailable',
        publicMessage: 'Browser session is unavailable',
        status: 502,
        cause: browserDeadlineCause,
      })
    },
    publicRejectClientCause() {
      return new PublicWidgetError({
        code: 'browser_session_required',
        publicMessage: 'The browser session requires attention',
        status: 409,
        cause: protocolMismatchCause,
      })
    },
  },
})

const testWidgetRegistry = createWidgetServerRegistry([
  toRuntimeWidgetServerDefinition({ typeId: 'test-widget', definition: testWidget }),
])
if (testWidgetRegistry instanceof Error) throw testWidgetRegistry

describe('createApp', () => {
  let app: App
  let base: string
  let now: number
  let browserFake: ReturnType<typeof makeFakeBrowserAutomationClient>
  let ops: ReturnType<typeof createMemoryOps>

  beforeEach(async () => {
    const pubsub = createMemoryPubSub()
    ops = createMemoryOps(pubsub)
    now = Date.parse('2026-06-16T10:00:00.000Z')
    browserFake = makeFakeBrowserAutomationClient()
    app = createApp({
      ops,
      subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
      now: () => now,
      widgetRegistry: testWidgetRegistry,
      browserClient: browserFake.client,
      authConfig: testAuthConfig,
      recovery: { tokenTtlMs: 60_000, maxSessionMs: 60_000, upstreamUrl: 'http://127.0.0.1:1' },
      testControls: {
        setNow: (ms) => {
          now = ms
        },
        reset: () => ops.clear(),
      },
    })
    await new Promise<void>((resolve) => app.server.listen(0, resolve))
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('GET /api/time returns the injected clock', async () => {
    const res = await fetch(`${base}/api/time`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ now })
  })

  it('PUT then GET round-trips a stored value', async () => {
    const put = await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ value: { count: 1 } }),
    })
    expect(put.status).toBe(204)
    const get = await fetch(`${base}/api/storage/${DEBTS_KEY}`)
    expect(await get.json()).toEqual({ value: { count: 1 } })
  })

  it('rejects a prefix listing outside the board/widget namespaces', async () => {
    const res = await fetch(`${base}/api/storage?prefix=session:`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
  })

  it('rejects an empty prefix, which would enumerate the whole keyspace', async () => {
    const res = await fetch(`${base}/api/storage?prefix=`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
  })

  it('cannot read a live session record through the generic storage GET', async () => {
    const { session } = await seedAccountWithSession(ops, now, 'cred-storage-guard')
    const key = encodeURIComponent(sessionKey(session.sessionId))
    const res = await fetch(`${base}/api/storage/${key}`)
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
  })

  it('rejects a write to the cron scheduler cursor through the generic storage PUT', async () => {
    const res = await fetch(
      `${base}/api/storage/${encodeURIComponent('cron:ofelia-poop-duty:autoApproveDay')}`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
        body: JSON.stringify({ value: { cursorMs: 0, failures: 0 } }),
      },
    )
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
  })

  it('rejects an append onto the session keyspace through the generic storage append', async () => {
    const { session } = await seedAccountWithSession(ops, now, 'cred-storage-guard-append')
    const key = encodeURIComponent(sessionKey(session.sessionId))
    const res = await fetch(`${base}/api/storage/${key}/append`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ entry: { evil: true } }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ error: { code: 'storage_forbidden' } })
  })

  it('still serves a legitimate widget key through all four generic storage verbs', async () => {
    const key = encodeURIComponent('w:t:ofelia-poop-duty:allowlist-check')
    const csrf = { 'X-Requested-With': 'MyBoard' }

    const put = await fetch(`${base}/api/storage/${key}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...csrf },
      body: JSON.stringify({ value: { ok: true } }),
    })
    expect(put.status).toBe(204)

    const get = await fetch(`${base}/api/storage/${key}`)
    expect(get.status).toBe(200)
    expect(await get.json()).toEqual({ value: { ok: true } })

    const list = await fetch(`${base}/api/storage?prefix=w:t:ofelia-poop-duty:`)
    expect(list.status).toBe(200)
    expect(((await list.json()) as { keys: string[] }).keys).toContain(
      'w:t:ofelia-poop-duty:allowlist-check',
    )

    const del = await fetch(`${base}/api/storage/${key}`, { method: 'DELETE', headers: csrf })
    expect(del.status).toBe(204)
    expect((await fetch(`${base}/api/storage/${key}`)).status).toBe(404)
  })

  it('POST /api/test/time pins the clock', async () => {
    const res = await fetch(`${base}/api/test/time`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iso: '2026-01-01T00:00:00.000Z' }),
    })
    expect(res.status).toBe(204)
    const time = await (await fetch(`${base}/api/time`)).json()
    expect(time).toEqual({ now: Date.parse('2026-01-01T00:00:00.000Z') })
  })

  it('POST /api/test/reset clears stored keys', async () => {
    await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ value: { count: 1 } }),
    })
    expect((await fetch(`${base}/api/test/reset`, { method: 'POST' })).status).toBe(204)
    expect((await fetch(`${base}/api/storage/${DEBTS_KEY}`)).status).toBe(404)
  })

  it('rejects a mutating /api request without the CSRF header', async () => {
    const res = await fetch(`${base}/api/storage/${DEBTS_KEY}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: [] }),
    })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ code: 'csrf_required' })
  })

  it('dispatches a validated widget event', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { echoed: 'hello', instanceId: 'placement-1' },
    })
  })

  it.each([
    ['missing widget', '/api/widgets/missing/echo', 404, 'unknown_widget'],
    ['missing event', '/api/widgets/test-widget/missing', 404, 'unknown_event'],
  ])('%s returns a safe error', async (_label, path, status, code) => {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ error: { code } })
  })

  it('rejects an invalid widget request body', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: '', payload: { value: 'hello' } }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'request_invalid' } })
  })

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: '{',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_json' } })
  })

  it('rejects an oversized body', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: 'x'.repeat(1_048_577),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: { code: 'body_too_large' } })
  })

  it('rejects a payload that does not match the event schema', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 1 } }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'payload_invalid' } })
  })

  it('serializes a PublicWidgetError with its code, status and meta', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/publicReject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
    })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({
      error: {
        code: 'browser_session_required',
        message: 'The browser session requires attention',
        meta: { sshTarget: 'admin@pi' },
      },
    })
  })

  it('omits meta from the envelope when a PublicWidgetError has none', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await fetch(`${base}/api/widgets/test-widget/publicRejectNoMeta`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
        body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
      })

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        error: { code: 'browser_configuration', message: 'Passport checker is not configured' },
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('logs the cause chain for a 5xx widget error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await fetch(`${base}/api/widgets/test-widget/publicRejectServerCause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
        body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
      })
      expect(res.status).toBe(502)
      expect(consoleError).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: browserDeadlineCause.message }),
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('warns (does not error) on a public 4xx widget error that still carries a cause', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await fetch(`${base}/api/widgets/test-widget/publicRejectClientCause`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
        body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
      })
      expect(res.status).toBe(409)
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ message: protocolMismatchCause.message }),
      )
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleWarn.mockRestore()
      consoleError.mockRestore()
    }
  })

  it('invokes a widget-scoped browser task through normal widget RPC', async () => {
    browserFake.setResult({ result: { echoed: 'from-browser' } })
    const res = await fetch(`${base}/api/widgets/test-widget/browserEcho`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { echoed: 'from-browser' } })
    expect(browserFake.calls).toEqual([
      {
        widgetId: 'test-widget',
        taskId: 'check',
        payload: { value: 'hello' },
      },
    ])
  })

  it('keeps non-browser routes healthy while browser automation is unavailable', async () => {
    const time = await fetch(`${base}/api/time`)
    expect(time.status).toBe(200)
    expect(await time.json()).toEqual({ now })

    const echo = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })
    expect(echo.status).toBe(200)
    expect(await echo.json()).toEqual({
      data: { echoed: 'hello', instanceId: 'placement-1' },
    })
  })

  it('resolves the signed-in viewer from the session cookie for a widget dispatch', async () => {
    const { account, session } = await seedAccountWithSession(ops, now, 'cred-whoami')
    const res = await fetch(`${base}/api/widgets/test-widget/whoami`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Requested-With': 'MyBoard',
        cookie: `session=${session.sessionId}`,
      },
      body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      data: { viewer: { accountId: account.id, name: 'Acc' } },
    })
  })

  it('fails a widget dispatch instead of falling through to a null viewer when the account behind the session is corrupt', async () => {
    const { account, session } = await seedAccountWithSession(ops, now, 'cred-whoami-corrupt')
    // Simulate a Valkey fault / deleted account behind a still-live session.
    await ops.del(accountKey(account.id))

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await fetch(`${base}/api/widgets/test-widget/whoami`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Requested-With': 'MyBoard',
          cookie: `session=${session.sessionId}`,
        },
        body: JSON.stringify({ instanceId: 'placement-1', payload: {} }),
      })

      expect(res.status).toBe(500)
      const body = (await res.json()) as { error: { code: string } }
      expect(body.error.code).toBe('internal_error')
    } finally {
      consoleError.mockRestore()
    }
  })

  it('POST /api/auth/register/options with an unknown token returns invite-not-found', async () => {
    const res = await fetch(`${base}/api/auth/register/options`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Requested-With': 'MyBoard' },
      body: JSON.stringify({ token: 'nonexistent-token' }),
    })
    expect(res.status).toBe(404)
    expect(await res.json()).toMatchObject({ code: 'invite_not_found' })
  })

  it('GET /api/auth/account returns account info for a signed-in device', async () => {
    const { session } = await seedAccountWithSession(ops, now, 'cred-a8-account')
    const res = await fetch(`${base}/api/auth/account`, {
      headers: { cookie: `session=${session.sessionId}` },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'Acc' })
  })

  it("GET /api/auth/devices lists the caller's devices", async () => {
    const { session } = await seedAccountWithSession(ops, now, 'cred-a8-devices')
    const res = await fetch(`${base}/api/auth/devices`, {
      headers: { cookie: `session=${session.sessionId}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { devices: Array<{ credentialId: string }> }
    expect(body.devices.map((device) => device.credentialId)).toContain('cred-a8-devices')
  })

  it('GET /api/auth/devices without a session is rejected by the router-level guard', async () => {
    const res = await fetch(`${base}/api/auth/devices`)
    expect(res.status).toBe(401)
  })

  it('POST /api/auth/devices/:credentialId/approve reaches the handler through the real param route', async () => {
    const { account, session } = await seedAccountWithSession(ops, now, 'cred-a8-owner')
    await storeDevice(ops, {
      credentialId: 'cred-a8-pending',
      publicKey: 'pk',
      signCount: 0,
      label: 'New phone',
      createdAt: now,
      lastSeenAt: now,
      disabled: false,
      accountId: account.id,
      status: 'pending',
      addedVia: 'add-token',
    })
    await addDeviceToAccount(ops, account.id, 'cred-a8-pending', { countsAgainstLimit: false })

    const res = await fetch(`${base}/api/auth/devices/cred-a8-pending/approve`, {
      method: 'POST',
      headers: { cookie: `session=${session.sessionId}`, 'X-Requested-With': 'MyBoard' },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('GET /api/auth/devices/events without a session returns 401', async () => {
    const res = await fetch(`${base}/api/auth/devices/events`)
    expect(res.status).toBe(401)
  })

  it('POST /api/test/seed-invite returns a token lookupInvite accepts', async () => {
    const res = await fetch(`${base}/api/test/seed-invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ttlMs: 60_000, maxUses: 1, label: 'Test invite' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { token: string; activateUrl: string }
    expect(typeof body.token).toBe('string')
    expect(body.activateUrl).toContain(`token=${body.token}`)

    const invite = await lookupInvite(ops, () => now, body.token)
    expect(invite).not.toBeInstanceOf(Error)
  })

  it('seed-session issues a working session cookie', async () => {
    const res = await fetch(`${base}/api/test/seed-session`, { method: 'POST' })
    expect(res.status).toBe(200)
    const { accountId } = (await res.json()) as { accountId: string; credentialId: string }
    expect(accountId).toBeTruthy()

    const cookie = res.headers.get('set-cookie')!.split(';')[0]
    const session = await fetch(`${base}/api/auth/session`, { headers: { cookie } })
    expect(session.status).toBe(200)
    expect(await session.json()).toEqual({ accountId })

    // expire-sessions kills it
    await fetch(`${base}/api/test/expire-sessions`, { method: 'POST' })
    expect((await fetch(`${base}/api/auth/session`, { headers: { cookie } })).status).toBe(401)
  })

  it('revoke-device cuts a seeded session on the next request', async () => {
    const res = await fetch(`${base}/api/test/seed-session`, { method: 'POST' })
    const { credentialId } = (await res.json()) as { credentialId: string }
    const cookie = res.headers.get('set-cookie')!.split(';')[0]

    await fetch(`${base}/api/test/revoke-device`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credentialId }),
    })
    expect((await fetch(`${base}/api/auth/session`, { headers: { cookie } })).status).toBe(401)
  })

  it('issues a recovery capability for a retained page', async () => {
    const { session } = await seedAccountWithSession(ops, now, 'cred-recovery')
    browserFake.setRecoveryState({ retained: true })

    const response = await fetch(`${base}/api/browser/recovery/passport-checker`, {
      method: 'POST',
      headers: {
        cookie: `session=${session.sessionId}`,
        'x-requested-with': 'MyBoard',
      },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ expiresInMs: 60_000 })
    expect(response.headers.getSetCookie().join(';')).toContain('mb_recovery=')
  })

  it('refuses to issue a recovery capability without a session', async () => {
    browserFake.setRecoveryState({ retained: true })

    const response = await fetch(`${base}/api/browser/recovery/passport-checker`, {
      method: 'POST',
      headers: { 'x-requested-with': 'MyBoard' },
    })

    expect(response.status).toBe(401)
  })

  it('closes the app even with a live recovery socket', async () => {
    const { session } = await seedAccountWithSession(ops, now, 'cred-recovery-close')
    browserFake.setRecoveryState({ retained: true })
    const issued = await fetch(`${base}/api/browser/recovery/passport-checker`, {
      method: 'POST',
      headers: { cookie: `session=${session.sessionId}`, 'x-requested-with': 'MyBoard' },
    })
    expect(issued.status).toBe(200)

    // No upstream is listening in this suite, so the upgrade is refused; the
    // point is that app.close() resolves regardless.
    await expect(app.close()).resolves.toBeUndefined()
  })

  it('POST /api/test/seed-invite is absent (404) when testControls is undefined', async () => {
    const pubsub = createMemoryPubSub()
    const noControlsOps = createMemoryOps(pubsub)
    const noControlsApp = createApp({
      ops: noControlsOps,
      subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
      now: () => now,
      widgetRegistry: testWidgetRegistry,
      browserClient: browserFake.client,
      authConfig: testAuthConfig,
      recovery: { tokenTtlMs: 60_000, maxSessionMs: 60_000, upstreamUrl: 'http://127.0.0.1:1' },
    })
    await new Promise<void>((resolve) => noControlsApp.server.listen(0, resolve))
    const noControlsBase = `http://localhost:${(noControlsApp.server.address() as AddressInfo).port}`
    try {
      const res = await fetch(`${noControlsBase}/api/test/seed-invite`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(404)
    } finally {
      await noControlsApp.close()
    }
  })
})

describe('cron tick route', () => {
  let app: App
  let base: string
  let now: number
  const runs: number[] = []

  beforeEach(async () => {
    runs.length = 0
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    now = Date.parse('2026-06-16T12:00:00+02:00')

    const cronWidget = defineWidgetServer({
      schemas: {},
      handlers: {},
      crons: {
        nightly: {
          schedule: '5 0 * * *',
          timeZone: 'Europe/Warsaw',
          run: ({ scheduledFor }) => {
            runs.push(scheduledFor)
          },
        },
      },
    })
    const registry = createWidgetServerRegistry([
      toRuntimeWidgetServerDefinition({ typeId: 'cron-widget', definition: cronWidget }),
    ])
    if (registry instanceof Error) throw registry

    app = createApp({
      ops,
      subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
      now: () => now,
      widgetRegistry: registry,
      browserClient: makeFakeBrowserAutomationClient().client,
      authConfig: testAuthConfig,
      recovery: { tokenTtlMs: 60_000, maxSessionMs: 60_000, upstreamUrl: 'http://127.0.0.1:1' },
      testControls: {
        setNow: (ms) => {
          now = ms
        },
        reset: () => ops.clear(),
      },
    })
    await new Promise<void>((resolve) => app.server.listen(0, resolve))
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  const tick = () => fetch(`${base}/api/test/cron/tick`, { method: 'POST' })

  it('seeds the cursor on the first tick without running anything', async () => {
    const res = await tick()

    expect(res.status).toBe(204)
    expect(runs).toEqual([])
  })

  it('runs the job once the occurrence is due', async () => {
    await tick()

    await fetch(`${base}/api/test/time`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ iso: '2026-06-17T00:06:00+02:00' }),
    })
    await tick()

    expect(runs).toEqual([Date.parse('2026-06-17T00:05:00+02:00')])
  })
})
