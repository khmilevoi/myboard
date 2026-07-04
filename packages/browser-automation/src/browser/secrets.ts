import fs from 'node:fs'
import path from 'node:path'

import * as errore from 'errore'

export type WidgetSecrets = {
  read(key: string): string | undefined
  has(key: string): boolean
}

function isSafeSecretKey(key: string) {
  return key.length > 0 && key !== '.' && key !== '..' && !key.includes('..') && !/[\\/]/.test(key)
}

function hasErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) return false
  if ('code' in error && error.code === code) return true
  return hasErrorCode(error.cause, code)
}

function isMissingSecretError(error: Error) {
  return hasErrorCode(error, 'ENOENT')
}

function readWidgetSecret(widgetId: string, dir: string, key: string) {
  if (!isSafeSecretKey(key)) return undefined

  const file = path.join(dir, `${widgetId}_${key}`)
  const result = errore.try(() => fs.readFileSync(file, 'utf8'))
  if (result instanceof Error) {
    if (isMissingSecretError(result)) return undefined

    console.warn('Failed to read widget secret', {
      widgetId,
      key,
      error: result,
    })
    return undefined
  }

  return result.trim()
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
