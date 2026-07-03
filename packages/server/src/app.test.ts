import type { AddressInfo } from 'node:net'

import { defineWidgetServer, toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { createApp, type App } from './app'
import { createMemoryOps, createMemoryPubSub } from './test/memory-ops'
import { createWidgetServerRegistry } from './widgets/registry'

const DEBTS_KEY = encodeURIComponent('w:t:ofelia-poop-duty:debts')

const testWidget = defineWidgetServer({
  schemas: {
    echo: {
      payload: z.object({ value: z.string() }),
      result: z.object({ echoed: z.string(), instanceId: z.string() }),
    },
  },
  handlers: {
    echo(payload, context) {
      return { echoed: payload.value, instanceId: context.instanceId }
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

  beforeEach(async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    now = Date.parse('2026-06-16T10:00:00.000Z')
    app = createApp({
      ops,
      subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
      now: () => now,
      widgetRegistry: testWidgetRegistry,
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
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: { count: 1 } }),
    })
    expect((await fetch(`${base}/api/test/reset`, { method: 'POST' })).status).toBe(204)
    expect((await fetch(`${base}/api/storage/${DEBTS_KEY}`)).status).toBe(404)
  })

  it('dispatches a validated widget event', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 'hello' } }),
    })
    expect(res.status).toBe(status)
    expect(await res.json()).toMatchObject({ error: { code } })
  })

  it('rejects an invalid widget request body', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: '', payload: { value: 'hello' } }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'request_invalid' } })
  })

  it('rejects malformed JSON', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: 'invalid_json' } })
  })

  it('rejects an oversized body', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'x'.repeat(1_048_577),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toMatchObject({ error: { code: 'body_too_large' } })
  })

  it('rejects a payload that does not match the event schema', async () => {
    const res = await fetch(`${base}/api/widgets/test-widget/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ instanceId: 'placement-1', payload: { value: 1 } }),
    })
    expect(res.status).toBe(422)
    expect(await res.json()).toMatchObject({ error: { code: 'payload_invalid' } })
  })
})
