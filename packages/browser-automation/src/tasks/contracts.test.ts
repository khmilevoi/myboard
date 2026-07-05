import {
  defineWidgetBrowser,
  defineWidgetBrowserTasks,
  toRuntimeWidgetBrowserDefinition,
  type InferWidgetBrowserTasks,
  type RuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

const schemas = defineWidgetBrowserTasks({
  check: {
    payload: z.object({ value: z.string().transform(Number) }),
    result: z.object({ echoed: z.number().transform(String) }),
  },
})

type Tasks = InferWidgetBrowserTasks<typeof schemas>
type BrowserContext = { runId: string }

const invalidRuntimeDefinition = {
  widgetId: 'broken',
  schemas,
  // @ts-expect-error runtime definitions must keep handler keys aligned with schemas
  handlers: {},
} satisfies RuntimeWidgetBrowserDefinition<BrowserContext, typeof schemas>

void invalidRuntimeDefinition

describe('widget browser contracts', () => {
  it('infers public input and validated output types from Zod schemas', () => {
    expectTypeOf<Tasks['check']['payload']>().toEqualTypeOf<{ value: string }>()
    expectTypeOf<Tasks['check']['result']>().toEqualTypeOf<{ echoed: string }>()
    expect(schemas.check.id).toBe('check')
    expectTypeOf(schemas.check.id).toEqualTypeOf<'check'>()
  })

  it('types handlers with validated payloads and caller-selected context', async () => {
    const definition = defineWidgetBrowser<BrowserContext>()({
      schemas,
      handlers: {
        async check(payload, context) {
          expectTypeOf(payload).toEqualTypeOf<{ value: number }>()
          expectTypeOf(context).toEqualTypeOf<BrowserContext>()
          expect(context.runId).toBe('run-1')
          return { echoed: payload.value }
        },
      },
    })

    expect(await definition.handlers.check({ value: 7 }, { runId: 'run-1' })).toEqual({
      echoed: 7,
    })
  })

  it('injects widget identity only at the runtime boundary', () => {
    const definition = defineWidgetBrowser<BrowserContext>()({
      schemas,
      handlers: {
        check: (payload) => ({ echoed: payload.value }),
      },
    })
    const runtime = toRuntimeWidgetBrowserDefinition({
      widgetId: 'passport-checker',
      definition,
    })

    expect('widgetId' in definition).toBe(false)
    expect(runtime.widgetId).toBe('passport-checker')
    expect(Object.keys(runtime.handlers)).toEqual(['check'])
  })
})
