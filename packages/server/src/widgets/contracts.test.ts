import {
  defineWidgetServer,
  toRuntimeWidgetServerDefinition,
  type InferWidgetEvents,
  type WidgetServerContext,
} from '@shared/widgets/contracts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

const schemas = {
  echo: {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  },
} as const

type Events = InferWidgetEvents<typeof schemas>

describe('widget contracts', () => {
  it('infers the client payload and result from Zod schemas', () => {
    expectTypeOf<Events['echo']['payload']>().toEqualTypeOf<{ value: string }>()
    expectTypeOf<Events['echo']['result']>().toEqualTypeOf<{ echoed: string }>()
  })

  it('keeps server handlers aligned and injects identity at the runtime boundary', async () => {
    const definition = defineWidgetServer({
      schemas,
      handlers: {
        echo(payload, context: WidgetServerContext) {
          expect(context.typeId).toBe('test-widget')
          return { echoed: payload.value }
        },
      },
    })
    const runtime = toRuntimeWidgetServerDefinition({
      typeId: 'test-widget',
      definition,
    })

    expect('typeId' in definition).toBe(false)
    expect(runtime.typeId).toBe('test-widget')
    expect(Object.keys(runtime.handlers)).toEqual(['echo'])
  })
})
