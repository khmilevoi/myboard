import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import {
  defineWidgetServer,
  type InferWidgetEvents,
  type WidgetServerContext,
} from '@shared/widgets/contracts'

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

  it('keeps server handlers aligned with the schemas', async () => {
    const definition = defineWidgetServer({
      typeId: 'test-widget',
      schemas,
      handlers: {
        echo(payload, context: WidgetServerContext) {
          expect(context.typeId).toBe('test-widget')
          return { echoed: payload.value }
        },
      },
    })

    expect(definition.typeId).toBe('test-widget')
    expect(Object.keys(definition.handlers)).toEqual(['echo'])
  })
})
