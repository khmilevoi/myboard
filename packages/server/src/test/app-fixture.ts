import type { AddressInfo } from 'node:net'

import { createApp } from '../app'
import { issueSession } from '../auth/sessions'
import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { makeScopedOwners, type ScopedOwners } from '../storage/scoped'
import { createWidgetServerRegistry, type WidgetServerRegistry } from '../widgets/registry'
import { seedAccountWithDevice, makeClock, makeConfig } from './auth-fixtures'
import { createMemoryOps, createMemoryPubSub, type MemoryOps } from './memory-ops'

export type TestApp = {
  base: string
  ops: MemoryOps
  seedSession(name: string): Promise<{ accountId: string; cookie: string }>
  close(): Promise<void>
}

/** A listening app over in-memory ops; `cookie` is a ready `Cookie` header value. */
export async function startTestApp(
  options: { scopedOwners?: ScopedOwners; widgetRegistry?: WidgetServerRegistry } = {},
): Promise<TestApp> {
  const pubsub = createMemoryPubSub()
  const ops = createMemoryOps(pubsub)
  const clock = makeClock(Date.parse('2026-06-16T10:00:00.000Z'))
  const config = makeConfig()
  const emptyRegistry = createWidgetServerRegistry([])
  if (emptyRegistry instanceof Error) throw emptyRegistry

  const app = createApp({
    ops,
    subscribe: (onMessage) => pubsub.subscribe('storage:events', onMessage),
    now: clock.now,
    widgetRegistry: options.widgetRegistry ?? emptyRegistry,
    browserClient: makeFakeBrowserAutomationClient().client,
    authConfig: config,
    recovery: { tokenTtlMs: 60_000, maxSessionMs: 60_000, upstreamUrl: 'http://127.0.0.1:1' },
    scopedOwners: options.scopedOwners ?? makeScopedOwners({ widgetTypeIds: [], moduleScopes: {} }),
  })
  await new Promise<void>((resolve) => app.server.listen(0, resolve))
  const base = `http://localhost:${(app.server.address() as AddressInfo).port}`

  let seeded = 0
  return {
    base,
    ops,
    async seedSession(name) {
      seeded += 1
      const credentialId = `cred-fixture-${seeded}`
      const account = await seedAccountWithDevice(ops, clock.now, credentialId, { name })
      const session = await issueSession(ops, config, clock.now, {
        accountId: account.id,
        credentialId,
      })
      return { accountId: account.id, cookie: `${config.sessionCookieName}=${session.sessionId}` }
    },
    close: () => app.close(),
  }
}
