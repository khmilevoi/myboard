import { describe, expect, it } from 'vitest'

import { resolveBuildInfo } from './build-info'

describe('resolveBuildInfo', () => {
  it('keeps the branch and shortens the commit', () => {
    expect(
      resolveBuildInfo('feat/env-badge-branch', '6c8ff7ca1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a'),
    ).toEqual({ branch: 'feat/env-badge-branch', commit: '6c8ff7c' })
  })

  it('treats absent and blank values as unknown', () => {
    expect(resolveBuildInfo(undefined, undefined)).toEqual({ branch: null, commit: null })
    expect(resolveBuildInfo('  ', '')).toEqual({ branch: null, commit: null })
  })

  it('trims whitespace around the branch', () => {
    expect(resolveBuildInfo(' dev\n', undefined).branch).toBe('dev')
  })

  it('drops a commit that is not a hex SHA', () => {
    expect(resolveBuildInfo('dev', 'HEAD').commit).toBeNull()
    expect(resolveBuildInfo('dev', 'abc').commit).toBeNull()
  })

  it('lower-cases the commit', () => {
    expect(resolveBuildInfo('dev', 'ABCDEF1234').commit).toBe('abcdef1')
  })
})
