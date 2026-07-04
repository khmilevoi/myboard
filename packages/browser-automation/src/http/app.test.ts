import type { AddressInfo } from 'node:net'

import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { makeBrowserService, type BrowserService } from '../service'
import { makeWidgetBrowserRegistry } from '../tasks/registry'
import { makeFakeExecutor, type FakeContext } from '../testing/fake-executor'
import { makeBrowserHttpApp, type BrowserHttpApp } from './app'

function buildService(): BrowserService {
  const { executor } = makeFakeExecutor()
  const definition = defineWidgetBrowser<FakeContext>()({
    schemas: {
      check: { payload: z.object({ value: z.string() }), result: z.object({ echoed: z.string() }) },
    },
    handlers: { check: (payload) => ({ echoed: payload.value }) },
  })
  const registry = makeWidgetBrowserRegistry([
    toRuntimeWidgetBrowserDefinition({ widgetId: 'demo', definition }),
  ])
  if (registry instanceof Error) throw registry
  return makeBrowserService({
    registry,
    executor,
    config: { queueWaitMs: 1000, executionMs: 1000 },
  })
}

describe('makeBrowserHttpApp', () => {
  let app: BrowserHttpApp
  let base: string
  let service: BrowserService

  beforeEach(async () => {
    service = buildService()
    app = makeBrowserHttpApp(service)
    await new Promise<void>((resolve) => app.server.listen(0, resolve))
    base = `http://localhost:${(app.server.address() as AddressInfo).port}`
  })

  afterEach(async () => {
    await app.close()
  })

  it('reports 503 health while starting and 200 once ready', async () => {
    const starting = await fetch(`${base}/health`)
    expect(starting.status).toBe(503)
    expect(await starting.json()).toEqual({ status: 'starting' })
    service.markReady()
    const ready = await fetch(`${base}/health`)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: 'ready' })
  })

  it('returns a success envelope', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { value: 'hi' } }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, result: { echoed: 'hi' } })
  })

  it('returns an error envelope for an unknown task', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/nope`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: {} }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      ok: false,
      error: { code: 'unknown_task', message: 'Unknown browser task' },
    })
  })

  it('returns a payload_invalid envelope for a bad payload', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { value: 123 } }),
    })
    const body = (await res.json()) as { ok: boolean; error: { code: string } }
    expect(res.status).toBe(200)
    expect(body.ok).toBe(false)
    expect(body.error.code).toBe('payload_invalid')
  })

  it('returns 503 when the service is not ready', async () => {
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: { value: 'hi' } }),
    })
    expect(res.status).toBe(503)
  })

  it('returns 400 for an unreadable body', async () => {
    service.markReady()
    const res = await fetch(`${base}/tasks/demo/check`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    expect(res.status).toBe(400)
  })
})
