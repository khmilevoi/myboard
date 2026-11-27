import { AVATAR_POLICY } from '@shared/files/contract'
import { describe, expect, it } from 'vitest'

import { productionFilePolicies } from './production-file-policies'

const CATS = { owner: 'module', id: 'cats', scope: 'shared' } as const

describe('productionFilePolicies', () => {
  it('accepts the cat avatar slot with the avatar policy', () => {
    expect(productionFilePolicies.resolve(CATS, 'cat/ofelia/avatar')).toBe(AVATAR_POLICY)
  })

  it('denies other cats keys and other modules', () => {
    expect(productionFilePolicies.resolve(CATS, 'cat/ofelia/profile')).toBeNull()
    expect(
      productionFilePolicies.resolve(
        { owner: 'module', id: 'notes', scope: 'shared' },
        'cat/ofelia/avatar',
      ),
    ).toBeNull()
  })
})
