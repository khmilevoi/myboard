import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { defineWidgetBrowserTasks, type WidgetServerBrowserApi } from './browser-contracts'
import type { BrowserGatewayError } from './browser-errors'

const tasks = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string().transform(Number) }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
})

describe('defineWidgetBrowserTasks', () => {
  it('adds the literal object key as the task ID', () => {
    expect(tasks.check.id).toBe('check')
    expectTypeOf(tasks.check.id).toEqualTypeOf<'check'>()
  })

  it('preserves input and output inference for server invocation', () => {
    const api = null as unknown as WidgetServerBrowserApi

    if (false) {
      const result = api.invoke(tasks.check, { value: '7' })
      expectTypeOf(result).toEqualTypeOf<Promise<BrowserGatewayError | { echoed: string }>>()

      // @ts-expect-error transformed payload input requires a string
      void api.invoke(tasks.check, { value: 7 })
    }
  })
})
