import { describe, expect, it } from 'vitest'

import { BrowserTaskError, toEnvelopeError } from '../errors'
import { UserInputProbeError, UserInputRequiredError } from './errors'

describe('UserInputRequiredError', () => {
  // The passport-checker server maps this code to HTTP 409 and the widget UI
  // switches to its noVNC recovery view on it. Renaming either the code or the
  // meta key silently breaks recovery for every deployed client.
  it('keeps the browser_session_required contract the recovery flow depends on', () => {
    const error = new UserInputRequiredError({ sshTarget: 'pi@myboard.local', novncPort: 6180 })
    expect(error).toBeInstanceOf(BrowserTaskError)
    expect(error.code).toBe('browser_session_required')
    expect(error.sshTarget).toBe('pi@myboard.local')
    expect(error.novncPort).toBe(6180)
    expect(error.publicMeta).toEqual({ sshTarget: 'pi@myboard.local', novncPort: 6180 })
  })

  it('carries only novncPort in public meta when no ssh target is configured', () => {
    const error = new UserInputRequiredError({ sshTarget: null, novncPort: 6180 })
    expect(error.sshTarget).toBeNull()
    expect(error.publicMeta).toEqual({ novncPort: 6180 })
  })

  // novncPort predates this option on some callers (e.g. widget-side test
  // doubles that construct this error directly); it must keep compiling and
  // degrade to the stack's usual noVNC port rather than an arbitrary one.
  it('defaults novncPort to 6080 when the caller omits it', () => {
    const error = new UserInputRequiredError({ sshTarget: null })
    expect(error.novncPort).toBe(6080)
    expect(error.publicMeta).toEqual({ novncPort: 6080 })
  })

  // The envelope is what actually crosses to the widget server and the client,
  // so the contract is pinned on the serialized form as well as on publicMeta.
  // meta now always carries novncPort — the widget's recovery hint needs the
  // real per-stack port even when there is no SSH target to show alongside it.
  it('serializes to the recovery envelope, with and without an ssh target', () => {
    expect(
      toEnvelopeError(
        new UserInputRequiredError({ sshTarget: 'pi@myboard.local', novncPort: 6180 }),
      ),
    ).toStrictEqual({
      code: 'browser_session_required',
      message: 'The browser session requires attention',
      meta: { sshTarget: 'pi@myboard.local', novncPort: 6180 },
    })
    expect(
      toEnvelopeError(new UserInputRequiredError({ sshTarget: null, novncPort: 6180 })),
    ).toStrictEqual({
      code: 'browser_session_required',
      message: 'The browser session requires attention',
      meta: { novncPort: 6180 },
    })
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
