import { BrowserTaskError } from '@shared/browser-automation/task-errors'
import { describe, expect, it } from 'vitest'

import {
  AutomationTimeoutError,
  BrowserServiceUnavailableError,
  BrowserTaskHandlerError,
  UnknownBrowserTaskError,
  toEnvelopeError,
} from './errors'

class WidgetOwnedTaskError extends BrowserTaskError {
  code = 'widget_owned'
  publicMessage = 'Widget-owned failure'
  get publicMeta(): Record<string, unknown> {
    return { phase: 'fixture' }
  }
}

describe('browser task errors', () => {
  it('serializes a public task error to its code and safe message', () => {
    const error = new UnknownBrowserTaskError({ widgetId: 'w', taskId: 't' })
    expect(error.code).toBe('unknown_task')
    expect(toEnvelopeError(error)).toEqual({
      code: 'unknown_task',
      message: 'Unknown browser task',
    })
  })

  it('includes only safe meta for timeouts', () => {
    const error = new AutomationTimeoutError({ phase: 'queue' })
    expect(toEnvelopeError(error)).toEqual({
      code: 'automation_timeout',
      message: 'The browser task timed out',
      meta: { phase: 'queue' },
    })
  })

  it('redacts unknown handler failures and their cause chains', () => {
    const secret = new Error('series=AB number=123456')
    const error = new BrowserTaskHandlerError({ widgetId: 'w', taskId: 't', cause: secret })
    const envelope = toEnvelopeError(error)
    expect(envelope).toEqual({ code: 'internal', message: 'Browser task failed' })
    expect(JSON.stringify(envelope)).not.toContain('123456')
  })

  it('wraps a plain non-task error as internal', () => {
    expect(toEnvelopeError(new Error('boom'))).toEqual({
      code: 'internal',
      message: 'Browser task failed',
    })
  })

  it('keeps service-unavailable separate from the task error hierarchy', () => {
    const error = new BrowserServiceUnavailableError({ state: 'draining' })
    expect(error).toBeInstanceOf(BrowserServiceUnavailableError)
    expect(error.state).toBe('draining')
  })

  it('serializes a widget-owned subclass of the shared task-error base', () => {
    expect(toEnvelopeError(new WidgetOwnedTaskError('private detail'))).toEqual({
      code: 'widget_owned',
      message: 'Widget-owned failure',
      meta: { phase: 'fixture' },
    })
  })
})
