import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeWidgetSecrets } from './secrets'

describe('makeWidgetSecrets', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a scoped secret file by widget prefix', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-secrets-'))
    fs.writeFileSync(path.join(dir, 'widget_a_apiKey'), 'secret-value')

    const secrets = makeWidgetSecrets('widget_a', dir)

    expect(secrets.has('apiKey')).toBe(true)
    expect(secrets.read('apiKey')).toBe('secret-value')
  })

  it('returns undefined for a missing secret', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-secrets-'))

    const secrets = makeWidgetSecrets('widget_a', dir)

    expect(secrets.has('missing')).toBe(false)
    expect(secrets.read('missing')).toBeUndefined()
  })

  it('does not read another widget scope', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-secrets-'))
    fs.writeFileSync(path.join(dir, 'widget_b_apiKey'), 'other-secret')

    const secrets = makeWidgetSecrets('widget_a', dir)

    expect(secrets.read('apiKey')).toBeUndefined()
    expect(secrets.has('apiKey')).toBe(false)
  })

  it('rejects path traversal in the key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-secrets-'))
    fs.writeFileSync(path.join(dir, 'widget_a_apiKey'), 'secret-value')

    const secrets = makeWidgetSecrets('widget_a', dir)

    expect(secrets.read('../apiKey')).toBeUndefined()
    expect(secrets.read('..')).toBeUndefined()
    expect(secrets.read(`nested${path.sep}apiKey`)).toBeUndefined()
  })

  it('reads fresh on every call', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-secrets-'))
    const file = path.join(dir, 'widget_a_apiKey')
    fs.writeFileSync(file, 'first-value')

    const secrets = makeWidgetSecrets('widget_a', dir)

    expect(secrets.read('apiKey')).toBe('first-value')
    fs.writeFileSync(file, 'second-value')
    expect(secrets.read('apiKey')).toBe('second-value')
  })

  it('never logs the secret value', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-secrets-'))
    const file = path.join(dir, 'widget_a_apiKey')
    fs.writeFileSync(file, 'top-secret')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined)

    const secrets = makeWidgetSecrets('widget_a', dir)

    expect(secrets.read('apiKey')).toBe('top-secret')

    const calls = [...warn.mock.calls, ...error.mock.calls, ...log.mock.calls, ...info.mock.calls, ...debug.mock.calls]
    expect(JSON.stringify(calls)).not.toContain('top-secret')
  })
})
