import { describe, expect, it } from 'vitest'
import { parseEnv, EnvError } from './env'

describe('parseEnv', () => {
  it('parses a valid env and applies the timeout default', () => {
    const env = parseEnv({ MODE: 'development', DEV: true, PROD: false })
    if (env instanceof Error) throw env
    expect(env.MODE).toBe('development')
    expect(env.VITE_WIDGET_HANDSHAKE_TIMEOUT_MS).toBe(5000)
  })

  it('coerces the handshake timeout from a string', () => {
    const env = parseEnv({
      MODE: 'production',
      DEV: false,
      PROD: true,
      VITE_WIDGET_HANDSHAKE_TIMEOUT_MS: '3000',
    })
    if (env instanceof Error) throw env
    expect(env.VITE_WIDGET_HANDSHAKE_TIMEOUT_MS).toBe(3000)
  })

  it('returns EnvError for a non-positive timeout', () => {
    const result = parseEnv({ MODE: 'x', DEV: false, PROD: true, VITE_WIDGET_HANDSHAKE_TIMEOUT_MS: '-5' })
    expect(result).toBeInstanceOf(EnvError)
  })
})
