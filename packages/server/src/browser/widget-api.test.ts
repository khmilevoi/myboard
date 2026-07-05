import { defineWidgetBrowserTasks } from '@shared/widgets/browser-contracts'
import {
  BrowserAutomationProtocolError,
  BrowserTaskRejectedError,
  type BrowserGatewayError,
} from '@shared/widgets/browser-errors'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { makeFakeBrowserAutomationClient } from './testing/fake-client'
import { createWidgetBrowserApi } from './widget-api'

const tasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
})

describe('createWidgetBrowserApi', () => {
  it('injects widget scope and validates the result', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 7 } })
    const api = createWidgetBrowserApi({ widgetId: 'passport-checker', client: fake.client })

    const result = await api.invoke(tasks.check, { value: 'hello' })
    expectTypeOf(result).toEqualTypeOf<BrowserGatewayError | { echoed: string }>()
    expect(result).toEqual({ echoed: '7' })
    expect(fake.calls).toEqual([
      {
        widgetId: 'passport-checker',
        taskId: 'check',
        payload: { value: 'hello' },
      },
    ])
  })

  it('returns a protocol error for an invalid success result', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 'not-a-number' } })
    const api = createWidgetBrowserApi({ widgetId: 'demo', client: fake.client })

    const result = await api.invoke(tasks.check, { value: 'hello' })
    expect(result).toBeInstanceOf(BrowserAutomationProtocolError)
    expect(result).toMatchObject({ phase: 'result', widgetId: 'demo', taskId: 'check' })
  })

  it('propagates gateway errors unchanged', async () => {
    const fake = makeFakeBrowserAutomationClient()
    const error = new BrowserTaskRejectedError({
      widgetId: 'demo',
      taskId: 'check',
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
    })
    fake.setResult(error)
    const api = createWidgetBrowserApi({ widgetId: 'demo', client: fake.client })

    expect(await api.invoke(tasks.check, { value: 'hello' })).toBe(error)
  })
})
