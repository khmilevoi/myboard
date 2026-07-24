import { describe, expect, it } from 'vitest'

import { BrowserGatewayConfigError, loadBrowserGatewayConfig } from './config'

describe('loadBrowserGatewayConfig', () => {
  it('applies internal-service defaults', () => {
    expect(loadBrowserGatewayConfig({})).toEqual({
      baseUrl: 'http://browser-automation:8788',
      timeoutMs: 100_000,
      recovery: {
        upstreamUrl: 'http://browser-automation:6080',
        tokenTtlMs: 60_000,
        maxSessionMs: 900_000,
      },
    })
  })

  it('normalizes a configured URL and parses the deadline', () => {
    expect(
      loadBrowserGatewayConfig({
        BROWSER_AUTOMATION_URL: 'http://browser:9000/',
        BROWSER_AUTOMATION_TIMEOUT_MS: '150000',
      }),
    ).toEqual({
      baseUrl: 'http://browser:9000',
      timeoutMs: 150_000,
      recovery: {
        upstreamUrl: 'http://browser-automation:6080',
        tokenTtlMs: 60_000,
        maxSessionMs: 900_000,
      },
    })
  })

  it('defaults the recovery transport configuration', () => {
    const config = loadBrowserGatewayConfig({})
    if (config instanceof Error) throw config

    expect(config.recovery).toEqual({
      upstreamUrl: 'http://browser-automation:6080',
      tokenTtlMs: 60_000,
      maxSessionMs: 900_000,
    })
  })

  it('reads the recovery transport configuration from the environment', () => {
    const config = loadBrowserGatewayConfig({
      BROWSER_RECOVERY_URL: 'http://vnc:6080/',
      BROWSER_RECOVERY_TOKEN_TTL_MS: '5000',
      BROWSER_RECOVERY_MAX_SESSION_MS: '60000',
    })
    if (config instanceof Error) throw config

    expect(config.recovery).toEqual({
      upstreamUrl: 'http://vnc:6080',
      tokenTtlMs: 5_000,
      maxSessionMs: 60_000,
    })
  })

  it('rejects a non-http recovery url', () => {
    expect(loadBrowserGatewayConfig({ BROWSER_RECOVERY_URL: 'ws://vnc:6080' })).toBeInstanceOf(
      BrowserGatewayConfigError,
    )
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
