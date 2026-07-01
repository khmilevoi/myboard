import { describe, expect, it } from 'vitest'

import { parseEnv, EnvError } from './env'

describe('parseEnv', () => {
  it('parses a valid env', () => {
    const env = parseEnv({ MODE: 'development', DEV: true, PROD: false })
    if (env instanceof Error) throw env
    expect(env.MODE).toBe('development')
    expect(env.DEV).toBe(true)
    expect(env.PROD).toBe(false)
  })

  it('returns EnvError for invalid input', () => {
    const result = parseEnv({ MODE: 123, DEV: true, PROD: false })
    expect(result).toBeInstanceOf(EnvError)
  })
})
