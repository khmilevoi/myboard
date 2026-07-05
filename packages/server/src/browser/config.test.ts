import { describe, expect, it } from 'vitest'

import { BrowserGatewayConfigError, loadBrowserGatewayConfig } from './config'

describe('loadBrowserGatewayConfig', () => {
  it('applies internal-service defaults', () => {
    expect(loadBrowserGatewayConfig({})).toEqual({
      baseUrl: 'http://browser-automation:8788',
      timeoutMs: 100_000,
    })
  })

  it('normalizes a configured URL and parses the deadline', () => {
    expect(
      loadBrowserGatewayConfig({
        BROWSER_AUTOMATION_URL: 'http://browser:9000/',
        BROWSER_AUTOMATION_TIMEOUT_MS: '150000',
      }),
    ).toEqual({ baseUrl: 'http://browser:9000', timeoutMs: 150_000 })
  })

  it.each([
    [{ BROWSER_AUTOMATION_URL: 'file:///tmp/browser' }, 'BROWSER_AUTOMATION_URL'],
    [{ BROWSER_AUTOMATION_TIMEOUT_MS: '0' }, 'BROWSER_AUTOMATION_TIMEOUT_MS'],
    [{ BROWSER_AUTOMATION_TIMEOUT_MS: 'nope' }, 'BROWSER_AUTOMATION_TIMEOUT_MS'],
  ])('returns a safe tagged error for invalid config %#', (env, field) => {
    const result = loadBrowserGatewayConfig(env)
    expect(result).toBeInstanceOf(BrowserGatewayConfigError)
    expect((result as BrowserGatewayConfigError).field).toBe(field)
  })
})
