import { BrowserTaskRejectedError } from '@shared/widgets/browser-errors'
import { describe, expect, it } from 'vitest'

import { makeFakeBrowserAutomationClient } from './fake-client'

describe('makeFakeBrowserAutomationClient', () => {
  it('records calls and returns the programmed value', async () => {
    const fake = makeFakeBrowserAutomationClient()
    fake.setResult({ result: { echoed: 'ok' } })

    expect(
      await fake.client.invoke({ widgetId: 'demo', taskId: 'check', payload: { value: 'ok' } }),
    ).toEqual({ result: { echoed: 'ok' } })
    expect(fake.calls).toEqual([{ widgetId: 'demo', taskId: 'check', payload: { value: 'ok' } }])
  })

  it('can return a gateway error as a value', async () => {
    const fake = makeFakeBrowserAutomationClient()
    const error = new BrowserTaskRejectedError({
      widgetId: 'demo',
      taskId: 'check',
      code: 'rejected',
      publicMessage: 'Rejected',
    })
    fake.setResult(error)

    expect(await fake.client.invoke({ widgetId: 'demo', taskId: 'check', payload: {} })).toBe(error)
  })
})
