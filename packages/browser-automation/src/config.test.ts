import { describe, expect, it } from 'vitest'

import { BrowserServiceConfigError, loadBrowserServiceConfig } from './config'

describe('loadBrowserServiceConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadBrowserServiceConfig({})).toEqual({
      port: 8788,
      queueWaitMs: 30_000,
      executionMs: 60_000,
    })
  })

  it('parses positive integer overrides', () => {
    const config = loadBrowserServiceConfig({
      PORT: '9000',
      BROWSER_QUEUE_WAIT_MS: '5000',
      BROWSER_TASK_TIMEOUT_MS: '15000',
    })
    expect(config).toEqual({ port: 9000, queueWaitMs: 5000, executionMs: 15000 })
  })

  it('returns a tagged error for a non-positive-integer value', () => {
    const result = loadBrowserServiceConfig({ BROWSER_TASK_TIMEOUT_MS: '-1' })
    expect(result).toBeInstanceOf(BrowserServiceConfigError)
  })

  it('returns a tagged error for a non-numeric value', () => {
    const result = loadBrowserServiceConfig({ PORT: 'abc' })
    expect(result).toBeInstanceOf(BrowserServiceConfigError)
  })
})
