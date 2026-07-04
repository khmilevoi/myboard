import fs from 'node:fs'
import path from 'node:path'

import * as errore from 'errore'

export type WidgetSecrets = {
  read(key: string): string | undefined
  has(key: string): boolean
}

function isSafeSecretKey(key: string) {
  return !key.includes('..') && !/[\\/]/.test(key)
}

function readWidgetSecret(widgetId: string, dir: string, key: string) {
  if (!isSafeSecretKey(key)) return undefined

  const file = path.join(dir, `${widgetId}_${key}`)
  const result = errore.try(() => fs.readFileSync(file, 'utf8'))
  if (result instanceof Error) return undefined
  return result
}

export function makeWidgetSecrets(widgetId: string, dir: string): WidgetSecrets {
  return {
    read(key: string) {
      return readWidgetSecret(widgetId, dir, key)
    },
    has(key: string) {
      return readWidgetSecret(widgetId, dir, key) !== undefined
    },
  }
}
