import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { BrowserTaskContext } from '../browser/context'
import { DuplicateWidgetBrowserTaskError } from './registry'
import { composeBrowserRegistry } from './compose'

const widgetDefinition = toRuntimeWidgetBrowserDefinition({
  widgetId: 'demo',
  definition: defineWidgetBrowser<BrowserTaskContext>()({
    schemas: { run: { payload: z.object({}), result: z.object({ ok: z.boolean() }) } },
    handlers: { run: async () => ({ ok: true }) },
  }),
})

describe('composeBrowserRegistry', () => {
  it('always registers the diagnostics task', () => {
    const registry = composeBrowserRegistry([])
    if (registry instanceof Error) throw registry
    expect(registry.get('__diagnostics__')?.has('browser-check')).toBe(true)
  })

  it('registers widget tasks alongside diagnostics', () => {
    const registry = composeBrowserRegistry([widgetDefinition])
    if (registry instanceof Error) throw registry
    expect(registry.get('demo')?.has('run')).toBe(true)
    expect(registry.get('__diagnostics__')?.has('browser-check')).toBe(true)
  })

  it('rejects a widget that collides with the diagnostics id', () => {
    const collision = toRuntimeWidgetBrowserDefinition({
      widgetId: '__diagnostics__',
      definition: defineWidgetBrowser<BrowserTaskContext>()({
        schemas: { 'browser-check': { payload: z.object({}), result: z.object({ ok: z.boolean() }) } },
        handlers: { 'browser-check': async () => ({ ok: true }) },
      }),
    })
    expect(composeBrowserRegistry([collision])).toBeInstanceOf(DuplicateWidgetBrowserTaskError)
  })
})
