import type { AddressInfo } from 'node:net'

import { createApp } from '../app'
import { issueSession } from '../auth/sessions'
import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import type { ModuleServerRegistry } from '../modules/registry'
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

export type OpenSse = {
  connId: string
  nextFrame(): Promise<{ key: string; value: unknown }>
  close(): void
}

/** Opens `/api/storage/events` and yields its unnamed `data:` frames one at a time. */
export async function openSse(base: string, cookie?: string): Promise<OpenSse> {
  const controller = new AbortController()
  const res = await fetch(`${base}/api/storage/events`, {
    headers: cookie ? { cookie } : {},
    signal: controller.signal,
  })
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const nextBlock = async (): Promise<string> => {
    for (;;) {
      const at = buffer.indexOf('\n\n')
      if (at >= 0) {
        const block = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        return block
      }
      const chunk = await reader.read()
      if (chunk.done) throw new Error('SSE stream ended')
      buffer += decoder.decode(chunk.value, { stream: true })
    }
  }
  const parse = (block: string) => ({
    event: /^event: (.*)$/m.exec(block)?.[1] ?? null,
    data: /^data: (.*)$/m.exec(block)?.[1],
  })
  const ready = parse(await nextBlock())
  const connId = (JSON.parse(ready.data ?? '{}') as { connId: string }).connId
  return {
    connId,
    async nextFrame() {
      for (;;) {
        const frame = parse(await nextBlock())
        if (frame.event === null && frame.data !== undefined) {
          return JSON.parse(frame.data) as { key: string; value: unknown }
        }
      }
    },
    close: () => controller.abort(),
  }
}

/** A listening app over in-memory ops; `cookie` is a ready `Cookie` header value. */
export async function startTestApp(
  options: {
    scopedOwners?: ScopedOwners
    widgetRegistry?: WidgetServerRegistry
    moduleRegistry?: ModuleServerRegistry
  } = {},
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
    moduleRegistry: options.moduleRegistry ?? new Map(),
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
