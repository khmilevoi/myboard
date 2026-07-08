import type { AddressInfo } from 'node:net'

import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import { defineWidgetServer, toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, type App } from './app'
import { addDeviceToAccount, createAccount } from './auth/accounts'
import type { AuthConfig } from './auth/config'
import { storeDevice } from './auth/devices'
import { lookupInvite } from './auth/invites'
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
  },
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
    },
    async browserEcho(payload, context) {
      return context.api.browser.invoke(browserTasks.check, payload)
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
    const { accountId, credentialId } = (await res.json()) as {
      accountId: string
      credentialId: string
    }
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
