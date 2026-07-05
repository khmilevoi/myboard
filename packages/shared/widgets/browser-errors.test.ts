import * as errore from 'errore'
import { describe, expect, it } from 'vitest'

import {
  BrowserAutomationDeadlineError,
  BrowserAutomationProtocolError,
  BrowserAutomationUnavailableError,
  BrowserTaskRejectedError,
} from './browser-errors'

describe('browser gateway errors', () => {
  it('uses a detectable typed abort reason for gateway deadlines', () => {
    const error = new BrowserAutomationDeadlineError({ timeoutMs: 100_000 })
    expect(error).toBeInstanceOf(errore.AbortError)
    expect(errore.isAbortError(error)).toBe(true)
    expect(error.timeoutMs).toBe(100_000)
  })

  it('keeps transport and protocol context free of request values', () => {
    expect(new BrowserAutomationUnavailableError({ operation: 'fetch' }).operation).toBe('fetch')
    const protocol = new BrowserAutomationProtocolError({
      phase: 'envelope',
      widgetId: 'passport-checker',
      taskId: 'check',
    })
    expect(protocol).toMatchObject({
      phase: 'envelope',
      widgetId: 'passport-checker',
      taskId: 'check',
    })
  })

  it('preserves safe remote rejection fields', () => {
    const error = new BrowserTaskRejectedError({
      widgetId: 'passport-checker',
      taskId: 'check',
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
      meta: { recovery: 'ssh' },
    })
    expect(error).toMatchObject({
      code: 'browser_session_required',
      publicMessage: 'Browser attention is required',
      meta: { recovery: 'ssh' },
    })
  })
})
