import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import {
  defineModuleServer,
  toRuntimeModuleServerDefinition,
  type ModuleScope,
  type ModuleServerContext,
} from '@shared/modules/contracts'
import type { WidgetViewer } from '@shared/widgets/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { startTestApp, type TestApp } from '../test/app-fixture'
import { makeModuleServerRegistry } from './registry'

const actions = {
  add: {
    payload: z.object({ text: z.string() }),
    result: z.object({ ok: z.literal(true) }),
  },
}

function makeRegistry(options: {
  scopes: ModuleScope[]
  spy: (viewer: WidgetViewer | null) => void
}) {
  const definition = defineModuleServer(
    { scopes: options.scopes, actions },
    {
      handlers: {
        add: async (payload, context) => {
          options.spy(context.viewer)
          const storage = context.api.storage as Partial<
            ModuleServerContext<ModuleScope>['api']['storage']
          >
          const shared = await storage.shared?.append('log', { text: payload.text })
          if (shared instanceof Error) return shared
          const account = await storage.account?.append('log', { text: payload.text })
          if (account instanceof Error) return account
          return { ok: true as const }
        },
      },
    },
  )
  const registry = makeModuleServerRegistry([
    toRuntimeModuleServerDefinition({ moduleId: 'notes', definition }),
  ])
  if (registry instanceof Error) throw registry
  return registry
}

let app: TestApp | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

const post = (base: string, path: string, body: unknown, cookie?: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CSRF_HEADER]: CSRF_HEADER_VALUE,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  })

const errorCode = async (res: Response) =>
  ((await res.json()) as { error: { code: string } }).error.code

describe('POST /api/modules/:moduleId/actions/:action', () => {
  it('runs an action for a signed-in viewer and writes both scopes', async () => {
    const spy = vi.fn()
    app = await startTestApp({
      moduleRegistry: makeRegistry({ scopes: ['shared', 'account'], spy }),
    })
    const session = await app.seedSession('Ann')

    const res = await post(
      app.base,
      '/api/modules/notes/actions/add',
      { payload: { text: 'hi' } },
      session.cookie,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { ok: true } })
    expect(await app.ops.get('m:notes:s:log')).toContain('hi')
    expect(await app.ops.get(`m:notes:a:${session.accountId}:log`)).toContain('hi')
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ accountId: session.accountId })
  })

  it('answers 401 account_required without a session and never runs the handler', async () => {
    const spy = vi.fn()
    app = await startTestApp({
      moduleRegistry: makeRegistry({ scopes: ['shared', 'account'], spy }),
    })

    const res = await post(app.base, '/api/modules/notes/actions/add', { payload: { text: 'hi' } })

    expect(res.status).toBe(401)
    expect(await errorCode(res)).toBe('account_required')
    expect(spy).not.toHaveBeenCalled()
    expect(await app.ops.get('m:notes:s:log')).toBeNull()
  })

  it('answers 422 payload_invalid for a bad payload', async () => {
    const spy = vi.fn()
    app = await startTestApp({
      moduleRegistry: makeRegistry({ scopes: ['shared', 'account'], spy }),
    })
    const session = await app.seedSession('Ann')

    const res = await post(
      app.base,
      '/api/modules/notes/actions/add',
      { payload: { text: 1 } },
      session.cookie,
    )

    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('payload_invalid')
    expect(spy).not.toHaveBeenCalled()
  })

  it('answers 404 unknown_module', async () => {
    app = await startTestApp({ moduleRegistry: makeRegistry({ scopes: ['shared'], spy: vi.fn() }) })
    const res = await post(app.base, '/api/modules/nope/actions/add', { payload: {} })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('unknown_module')
  })

  it.each(['missing', 'toString'])('answers 404 unknown_action for %s', async (action) => {
    app = await startTestApp({ moduleRegistry: makeRegistry({ scopes: ['shared'], spy: vi.fn() }) })
    const res = await post(app.base, `/api/modules/notes/actions/${action}`, { payload: {} })
    expect(res.status).toBe(404)
    expect(await errorCode(res)).toBe('unknown_action')
  })

  it('lets a shared-only module run without a session', async () => {
    const spy = vi.fn()
    app = await startTestApp({ moduleRegistry: makeRegistry({ scopes: ['shared'], spy }) })

    const res = await post(app.base, '/api/modules/notes/actions/add', { payload: { text: 'hi' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { ok: true } })
    expect(spy).toHaveBeenCalledOnce()
  })

  it('answers 422 request_invalid when the body is not an object', async () => {
    app = await startTestApp({ moduleRegistry: makeRegistry({ scopes: ['shared'], spy: vi.fn() }) })
    const res = await post(app.base, '/api/modules/notes/actions/add', 'nope')
    expect(res.status).toBe(422)
    expect(await errorCode(res)).toBe('request_invalid')
  })
})
