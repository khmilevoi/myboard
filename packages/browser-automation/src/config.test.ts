import { describe, expect, it } from 'vitest'

import { BrowserServiceConfigError, loadBrowserServiceConfig } from './config'

describe('loadBrowserServiceConfig', () => {
  it('applies defaults when nothing is set', () => {
    expect(loadBrowserServiceConfig({})).toEqual({
      port: 8788,
      queueWaitMs: 30_000,
      executionMs: 60_000,
      profileDir: '/profile',
      secretsDir: '/run/secrets',
      recoverySshTarget: null,
      novncPort: 6080,
    })
  })

  it('parses positive integer overrides', () => {
    const config = loadBrowserServiceConfig({
      PORT: '9000',
      BROWSER_QUEUE_WAIT_MS: '5000',
      BROWSER_TASK_TIMEOUT_MS: '15000',
    })
    expect(config).toEqual({
      port: 9000,
      queueWaitMs: 5000,
      executionMs: 15000,
      profileDir: '/profile',
      secretsDir: '/run/secrets',
      recoverySshTarget: null,
      novncPort: 6080,
    })
  })

  // Must stay in lockstep with docker-compose.yml's NOVNC_HOST_PORT, which
  // drives the publish line the container itself cannot introspect.
  it('reads a NOVNC_HOST_PORT override', () => {
    const config = loadBrowserServiceConfig({ NOVNC_HOST_PORT: '6180' })
    expect(config).toMatchObject({ novncPort: 6180 })
  })

  it('returns a tagged error for a non-positive-integer NOVNC_HOST_PORT', () => {
    const result = loadBrowserServiceConfig({ NOVNC_HOST_PORT: '0' })
    expect(result).toBeInstanceOf(BrowserServiceConfigError)
  })

  it('normalizes a usable AUTOMATION_SSH_TARGET', () => {
    expect(loadBrowserServiceConfig({ AUTOMATION_SSH_TARGET: ' pi@myboard.local ' })).toMatchObject(
      { recoverySshTarget: 'pi@myboard.local' },
    )
    expect(loadBrowserServiceConfig({ AUTOMATION_SSH_TARGET: '192.168.1.10' })).toMatchObject({
      recoverySshTarget: '192.168.1.10',
    })
  })

  // The value is public recovery metadata the UI shows, and config failures
  // reach process.exit(1) in index.ts. A typo in .env must cost the SSH hint,
  // never the whole automation service.
  it.each(['pi@host; shutdown', '', 'pi@host/../etc'])(
    'degrades an unusable AUTOMATION_SSH_TARGET to null instead of failing the config',
    (value) => {
      const config = loadBrowserServiceConfig({ AUTOMATION_SSH_TARGET: value })
      expect(config).not.toBeInstanceOf(BrowserServiceConfigError)
      expect(config).toMatchObject({ recoverySshTarget: null })
    },
  )

  it('reads profile and secrets directory overrides', () => {
    const config = loadBrowserServiceConfig({
      BROWSER_PROFILE_DIR: '/data/profile',
      BROWSER_SECRETS_DIR: '/tmp/secrets',
    })
    expect(config).toMatchObject({ profileDir: '/data/profile', secretsDir: '/tmp/secrets' })
  })

  it('falls back to defaults when profile and secrets directories are empty', () => {
    const config = loadBrowserServiceConfig({
      BROWSER_PROFILE_DIR: '',
      BROWSER_SECRETS_DIR: '',
    })
    expect(config).toMatchObject({ profileDir: '/profile', secretsDir: '/run/secrets' })
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
