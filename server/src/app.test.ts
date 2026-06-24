import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp, type App } from './app'
import { createMemoryOps, createMemoryPubSub } from './test/memory-ops'

const DEBTS_KEY = encodeURIComponent('w:t:ofelia-poop-duty:debts')

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
})
