// @vitest-environment node
import { describe, expect, expectTypeOf, it } from 'vitest'

// oxlint-disable-next-line no-restricted-imports -- browser-automation only exports ./task-context; this reaches its toEnvelopeError helper directly, as the brief specifies.
import { toEnvelopeError } from '../../../browser-automation/src/errors'
import { passportCheckerBrowserSchemas, passportCheckerBrowserTasks } from '../types'
import {
  BrowserConfigurationError,
  InvalidCheckerResponseError,
  UpstreamResponseError,
} from './errors'

describe('passport checker browser contracts', () => {
  it('requires a strict empty payload and task id', () => {
    expect(passportCheckerBrowserSchemas.check.payload.safeParse({}).success).toBe(true)
    expect(passportCheckerBrowserSchemas.check.payload.safeParse({ series: 'АБ' }).success).toBe(
      false,
    )
    expect(passportCheckerBrowserTasks.check.id).toBe('check')
    expectTypeOf(passportCheckerBrowserTasks.check.id).toEqualTypeOf<'check'>()
  })

  it('requires both document branches and strips successes to safe service fields', () => {
    const result = passportCheckerBrowserSchemas.check.result.safeParse({
      idCard: {
        kind: 'success',
        status: 1,
        send_status_msg: 'ID ok',
        ignored: true,
      },
      internationalPassport: {
        kind: 'success',
        status: 2,
        send_status_msg: 'International ok',
        ignored: true,
      },
      ignored: true,
    })

    expect(result.data).toEqual({
      idCard: { kind: 'success', status: 1, send_status_msg: 'ID ok' },
      internationalPassport: {
        kind: 'success',
        status: 2,
        send_status_msg: 'International ok',
      },
    })
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        idCard: { kind: 'success', status: 1, send_status_msg: 'ID ok' },
      }).success,
    ).toBe(false)
  })

  it('accepts only the two public document error codes', () => {
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        idCard: { kind: 'error', code: 'upstream_response' },
        internationalPassport: { kind: 'error', code: 'invalid_checker_response' },
      }).success,
    ).toBe(true)
    expect(
      passportCheckerBrowserSchemas.check.result.safeParse({
        idCard: { kind: 'error', code: 'browser_configuration' },
        internationalPassport: { kind: 'error', code: 'invalid_checker_response' },
      }).success,
    ).toBe(false)
  })

  it('serializes only stable public codes, messages, and safe metadata', () => {
    expect(toEnvelopeError(new BrowserConfigurationError())).toEqual({
      code: 'browser_configuration',
      message: 'Passport checker is not configured',
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

  // browser_session_required is now UserInputRequiredError's contract, owned
  // and envelope-tested by browser-automation/src/user-input/errors.test.ts
  // (the sshTarget-present and sshTarget-null/no-meta cases both live there).

  it('reports meta as exactly { phase } for an upstream error with no status', () => {
    expect(toEnvelopeError(new UpstreamResponseError({ phase: 'navigation' }))).toStrictEqual({
      code: 'upstream_response',
      message: 'Passport checker is temporarily unavailable',
      meta: { phase: 'navigation' },
    })
  })
})
