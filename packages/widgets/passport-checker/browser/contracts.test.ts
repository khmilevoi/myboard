import { describe, expect, expectTypeOf, it } from 'vitest'

// oxlint-disable-next-line no-restricted-imports -- browser-automation only exports ./task-context; this reaches its toEnvelopeError helper directly, as the brief specifies.
import { toEnvelopeError } from '../../../browser-automation/src/errors'
import { passportCheckerBrowserSchemas, passportCheckerBrowserTasks } from '../types'
import {
  BrowserConfigurationError,
  BrowserSessionRequiredError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

describe('passport checker browser contracts', () => {
  it('requires a strict empty payload and an integer checker result', () => {
    expect(passportCheckerBrowserSchemas.check.payload.safeParse({}).success).toBe(true)
    expect(passportCheckerBrowserSchemas.check.payload.safeParse({ series: 'АБ' }).success).toBe(
      false,
    )
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        status: 1,
        send_status_msg: 'ok',
        ignored: true,
      }).data,
    ).toEqual({ status: 1, send_status_msg: 'ok' })
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        status: 1.5,
        send_status_msg: 'bad',
      }).success,
    ).toBe(false)
    expect(passportCheckerBrowserTasks.check.id).toBe('check')
    expectTypeOf(passportCheckerBrowserTasks.check.id).toEqualTypeOf<'check'>()
  })

  it('serializes only stable public codes, messages, and safe metadata', () => {
    expect(toEnvelopeError(new BrowserConfigurationError())).toEqual({
      code: 'browser_configuration',
      message: 'Passport checker is not configured',
    })
    expect(
      toEnvelopeError(new BrowserSessionRequiredError({ sshTarget: 'pi@myboard.local' })),
    ).toEqual({
      code: 'browser_session_required',
      message: 'The browser session requires attention',
      meta: { sshTarget: 'pi@myboard.local' },
    })
    expect(
      toEnvelopeError(new UpstreamResponseError({ phase: 'submission', status: 503 })),
    ).toEqual({
      code: 'upstream_response',
      message: 'Passport checker is temporarily unavailable',
      meta: { phase: 'submission', status: 503 },
    })
    expect(toEnvelopeError(new InvalidCheckerResponseError())).toEqual({
      code: 'invalid_checker_response',
      message: 'Passport checker returned an unexpected response',
    })
  })
})
