import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { makeRecoveryCapabilityStore } from './capability'
import { makeRecoveryRevokingClient } from './revoking-client'

describe('makeRecoveryRevokingClient', () => {
  it('destroys the live recovery connection before dispatching a task', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { ok: true } })
    const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
    const order: string[] = []
    store.attach({ widgetId: 'passport-checker', destroy: () => order.push('destroyed') })
    const client = makeRecoveryRevokingClient({ client: fake.client, store })

    await client.invoke({ widgetId: 'passport-checker', taskId: 'check', payload: {} })
    order.push('dispatched')

    expect(order).toEqual(['destroyed', 'dispatched'])
    expect(store.isBusy()).toBe(false)
  })

  it('leaves another widget recovery session alone', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { ok: true } })
    const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
    let destroyed = 0
    store.attach({ widgetId: 'passport-checker', destroy: () => (destroyed += 1) })
    const client = makeRecoveryRevokingClient({ client: fake.client, store })

    await client.invoke({ widgetId: 'other-widget', taskId: 'check', payload: {} })

    expect(destroyed).toBe(0)
    expect(store.isBusy()).toBe(true)
  })

  it('delegates the availability query without revoking', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setRecoveryState({ retained: true })
    const store = makeRecoveryCapabilityStore({ now: () => 1_000, tokenTtlMs: 60_000 })
    let destroyed = 0
    store.attach({ widgetId: 'passport-checker', destroy: () => (destroyed += 1) })
    const client = makeRecoveryRevokingClient({ client: fake.client, store })

    expect(await client.recoveryState({ widgetId: 'passport-checker' })).toEqual({ retained: true })
    expect(destroyed).toBe(0)
  })
})
