import type { Page } from 'playwright'
import { describe, expect, it } from 'vitest'

import type { BrowserTaskContext } from './browser/context'
import type { WidgetSecrets } from './browser/secrets'
import { diagnosticsDefinition, DIAGNOSTICS_WIDGET_ID } from './diagnostics'

function fakePage(userAgent: string): Page {
  return {
    goto: async () => null,
    evaluate: async () => userAgent,
  } as unknown as Page
}

function fakeSecrets(value: string | undefined): WidgetSecrets {
  return {
    read: (key) => (key === 'probe' ? value : undefined),
    has: (key) => key === 'probe' && value !== undefined,
  }
}

const handler = diagnosticsDefinition.handlers['browser-check']

describe('diagnostics browser-check', () => {
  it('uses the reserved diagnostics widget id', () => {
    expect(DIAGNOSTICS_WIDGET_ID).toBe('__diagnostics__')
    expect(diagnosticsDefinition.widgetId).toBe('__diagnostics__')
  })

  it('reports ok, the user agent, and secret presence', async () => {
    const context: BrowserTaskContext = {
      page: fakePage('FakeUA/1.0'),
      secrets: fakeSecrets('present'),
    }
    const result = await handler({}, context)
    expect(result).toEqual({ ok: true, secretPresent: true, userAgent: 'FakeUA/1.0' })
  })

  it('reports secretPresent false when the probe is absent', async () => {
    const context: BrowserTaskContext = {
      page: fakePage('FakeUA/1.0'),
      secrets: fakeSecrets(undefined),
    }
    const result = await handler({}, context)
    expect(result).toMatchObject({ ok: true, secretPresent: false })
  })

  it('never echoes the secret value', async () => {
    const context: BrowserTaskContext = {
      page: fakePage('FakeUA/1.0'),
      secrets: fakeSecrets('TOP-SECRET'),
    }
    const result = await handler({}, context)
    expect(JSON.stringify(result)).not.toContain('TOP-SECRET')
  })
})
