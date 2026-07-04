import {
  defineWidgetBrowser,
  toRuntimeWidgetBrowserDefinition,
} from '@shared/widgets/browser-contracts'
import { z } from 'zod'

import type { BrowserTaskContext } from './browser/context'

export const DIAGNOSTICS_WIDGET_ID = '__diagnostics__'

const definition = defineWidgetBrowser<BrowserTaskContext>()({
  schemas: {
    'browser-check': {
      payload: z.object({}),
      result: z.object({
        ok: z.boolean(),
        secretPresent: z.boolean(),
        userAgent: z.string(),
      }),
    },
  },
  handlers: {
    'browser-check': async (_payload, { page, secrets }) => {
      await page.goto('about:blank')
      // String form avoids pulling the DOM lib into this Node service's tsconfig.
      const userAgent = String(await page.evaluate('navigator.userAgent'))
      return { ok: true, secretPresent: secrets.read('probe') !== undefined, userAgent }
    },
  },
})

export const diagnosticsDefinition = toRuntimeWidgetBrowserDefinition({
  widgetId: DIAGNOSTICS_WIDGET_ID,
  definition,
})
