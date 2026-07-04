import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { DuplicateWidgetBrowserTaskError, makeWidgetBrowserRegistry } from './registry'

type BrowserContext = { runId: string }

function makeDefinition(widgetId: string) {
  const schema = {
    payload: z.object({ value: z.string() }),
    result: z.object({ echoed: z.string() }),
  }
  const definition = defineWidgetBrowser<BrowserContext>()({
    schemas: { check: schema },
    handlers: { check: (payload) => ({ echoed: payload.value }) },
  })
  return toRuntimeWidgetBrowserDefinition({ widgetId, definition })
}

describe('widget browser registry', () => {
  it('indexes each task under its widget and task IDs', () => {
    const definition = makeDefinition('passport-checker')
    const registry = makeWidgetBrowserRegistry([definition])
    if (registry instanceof Error) throw registry

    const task = registry.get('passport-checker')?.get('check')
    expect(task).toMatchObject({ widgetId: 'passport-checker', taskId: 'check' })
    expect(task?.payloadSchema).toBe(definition.schemas.check.payload)
    expect(task?.resultSchema).toBe(definition.schemas.check.result)
    expect(task?.handler).toBe(definition.handlers.check)
  })

  it('returns a tagged error for a duplicate widget/task pair', () => {
    const first = makeDefinition('passport-checker')
    const second = makeDefinition('passport-checker')
    const result = makeWidgetBrowserRegistry([first, second])

    expect(result).toBeInstanceOf(DuplicateWidgetBrowserTaskError)
    expect(result).toMatchObject({ widgetId: 'passport-checker', taskId: 'check' })
  })

  it('allows the same task ID under different widgets', () => {
    const result = makeWidgetBrowserRegistry([makeDefinition('first'), makeDefinition('second')])

    expect(result).not.toBeInstanceOf(Error)
  })
})
