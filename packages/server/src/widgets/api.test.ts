import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { makeFakeBrowserAutomationClient } from '../browser/testing/fake-client'
import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { createWidgetServerApi } from './api'

const tasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
})

describe('createWidgetServerApi', () => {
  it('composes storage scopes with a widget-scoped browser client', async () => {
    const pubsub = createMemoryPubSub()
    const ops = createMemoryOps(pubsub)
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 'ok' } })

    const api = createWidgetServerApi({
      ops,
      typeId: 'demo',
      instanceId: 'placement-1',
      ip: null,
      now: () => 123,
      browserClient: fake.client,
    })

    expect(await api.storage.instance.set('value', 1)).toBeUndefined()
    expect(await api.browser.invoke(tasks.check, { value: 'ok' })).toEqual({ echoed: 'ok' })
    expect(fake.calls[0]).toMatchObject({ widgetId: 'demo', taskId: 'check' })
  })
})
