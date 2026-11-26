import catsServer from '@modules/cats/server'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@shared/http/csrf'
import { toRuntimeModuleServerDefinition } from '@shared/modules/contracts'
import { afterEach, describe, expect, it } from 'vitest'

import { makeScopedOwners } from '../storage/scoped'
import { startTestApp, type TestApp } from '../test/app-fixture'
import { makeModuleServerRegistry } from './registry'

const registry = makeModuleServerRegistry([
  toRuntimeModuleServerDefinition({ moduleId: 'cats', definition: catsServer }),
])
if (registry instanceof Error) throw registry

let app: TestApp | undefined
afterEach(async () => {
  await app?.close()
  app = undefined
})

const post = (base: string, path: string, body: unknown, cookie: string) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [CSRF_HEADER]: CSRF_HEADER_VALUE,
      cookie,
    },
    body: JSON.stringify(body),
  })

describe('cats module actions over HTTP', () => {
  it('POST /api/modules/cats/actions/clean appends a cleaned entry to the module ledger', async () => {
    app = await startTestApp({
      moduleRegistry: registry,
      scopedOwners: makeScopedOwners({ widgetTypeIds: [], moduleScopes: { cats: ['shared'] } }),
    })
    const session = await app.seedSession('Карина')

    const res = await post(
      app.base,
      '/api/modules/cats/actions/clean',
      { payload: { date: '2026-06-16' } },
      session.cookie,
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { ok: true } })
    const ledger = JSON.parse((await app.ops.get('m:cats:s:duty/ledger')) ?? '[]') as {
      date: string
      type: string
      createdBy: { accountId: string }
    }[]
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({
      date: '2026-06-16',
      type: 'cleaned',
      createdBy: { accountId: session.accountId },
    })
  })

  it('the old widget route is gone: POST /api/widgets/ofelia-poop-duty/clean answers 404 unknown_widget', async () => {
    app = await startTestApp({ moduleRegistry: registry })
    const session = await app.seedSession('Карина')

    const res = await post(
      app.base,
      '/api/widgets/ofelia-poop-duty/clean',
      { instanceId: 'i1', payload: { date: '2026-06-16' } },
      session.cookie,
    )

    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('unknown_widget')
  })
})
