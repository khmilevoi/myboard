import { describe, expect, it } from 'vitest'

import { BrowserTaskError } from '../errors'
import { UserInputProbeError, UserInputRequiredError } from './errors'

describe('UserInputRequiredError', () => {
  // The passport-checker server maps this code to HTTP 409 and the widget UI
  // switches to its noVNC recovery view on it. Renaming either the code or the
  // meta key silently breaks recovery for every deployed client.
  it('keeps the browser_session_required contract the recovery flow depends on', () => {
    const error = new UserInputRequiredError({ sshTarget: 'pi@myboard.local' })
    expect(error).toBeInstanceOf(BrowserTaskError)
    expect(error.code).toBe('browser_session_required')
    expect(error.sshTarget).toBe('pi@myboard.local')
    expect(error.publicMeta).toEqual({ sshTarget: 'pi@myboard.local' })
  })

  it('omits public meta entirely when no ssh target is configured', () => {
    const error = new UserInputRequiredError({ sshTarget: null })
    expect(error.sshTarget).toBeNull()
    expect(error.publicMeta).toBeUndefined()
  })
})

describe('UserInputProbeError', () => {
  it('carries its own code and preserves the detector failure as cause', () => {
    const cause = new Error('page.evaluate failed')
    const error = new UserInputProbeError({ cause })
    expect(error).toBeInstanceOf(BrowserTaskError)
    expect(error.code).toBe('user_input_probe')
    expect(error.cause).toBe(cause)
  })

  it('accepts a non-Error cause, because a rejected probe may throw anything', () => {
    const error = new UserInputProbeError({ cause: 'string rejection' })
    expect(error.code).toBe('user_input_probe')
    expect(error.cause).toBe('string rejection')
  })
})
