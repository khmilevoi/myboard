import { describe, expect, it } from 'vitest'
import { parseHostMessage, parseWidgetMessage } from './parse'
import { BridgeError } from './errors'

describe('parseHostMessage', () => {
  it('accepts a valid init message and defaults a missing theme to light', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'small' })
    expect(result).toEqual({ type: 'init', instanceId: 'a1', mode: 'small', theme: 'light' })
  })

  it('keeps an explicit theme on init', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'small', theme: 'dark' })
    expect(result).toEqual({ type: 'init', instanceId: 'a1', mode: 'small', theme: 'dark' })
  })

  it('rejects an init message with an invalid theme', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'small', theme: 'neon' })
    expect(result).toBeInstanceOf(BridgeError)
  })

  it('rejects an init message with an invalid mode', () => {
    const result = parseHostMessage({ type: 'init', instanceId: 'a1', mode: 'huge' })
    expect(result).toBeInstanceOf(BridgeError)
  })

  it('accepts a valid theme-change message', () => {
    expect(parseHostMessage({ type: 'theme-change', theme: 'dark' })).toEqual({
      type: 'theme-change',
      theme: 'dark',
    })
  })

  it('rejects a theme-change message with an invalid theme', () => {
    expect(parseHostMessage({ type: 'theme-change', theme: 'beige' })).toBeInstanceOf(BridgeError)
  })

  it('rejects non-object input', () => {
    expect(parseHostMessage(null)).toBeInstanceOf(BridgeError)
    expect(parseHostMessage('init')).toBeInstanceOf(BridgeError)
  })

  it('rejects an unknown type', () => {
    expect(parseHostMessage({ type: 'nope' })).toBeInstanceOf(BridgeError)
  })
})

describe('parseWidgetMessage', () => {
  it('accepts a valid ready message', () => {
    const result = parseWidgetMessage({ type: 'ready', instanceId: 'a1' })
    expect(result).toEqual({ type: 'ready', instanceId: 'a1' })
  })

  it('accepts a request-fullscreen message', () => {
    const result = parseWidgetMessage({ type: 'request-fullscreen', instanceId: 'a1' })
    expect(result).toEqual({ type: 'request-fullscreen', instanceId: 'a1' })
  })

  it('accepts an error message', () => {
    const result = parseWidgetMessage({ type: 'error', message: 'boom' })
    expect(result).toEqual({ type: 'error', message: 'boom' })
  })

  it('rejects a ready message without instanceId', () => {
    expect(parseWidgetMessage({ type: 'ready' })).toBeInstanceOf(BridgeError)
  })
})
