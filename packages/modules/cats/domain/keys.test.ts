import { describe, expect, it } from 'vitest'

import {
  CATS_REGISTRY_KEY,
  catGoalKey,
  catProfileKey,
  catWeightKey,
  commentsKey,
  ledgerKey,
  LITTERS_REGISTRY_KEY,
  litterSettingsKey,
} from './keys'

describe('cats keys', () => {
  it('scopes the litter keys under litter/<id>/', () => {
    expect(ledgerKey('ofelia')).toBe('litter/ofelia/ledger')
    expect(commentsKey('ofelia', '2026-06-15')).toBe('litter/ofelia/comments:2026-06-15')
    expect(litterSettingsKey('ofelia')).toBe('litter/ofelia/settings')
  })

  it('scopes the cat keys under cat/<id>/', () => {
    expect(catProfileKey('ofelia')).toBe('cat/ofelia/profile')
    expect(catGoalKey('ofelia')).toBe('cat/ofelia/goal')
    expect(catWeightKey('ofelia')).toBe('cat/ofelia/weight')
  })

  it('pins the registry keys', () => {
    expect(CATS_REGISTRY_KEY).toBe('registry/cats')
    expect(LITTERS_REGISTRY_KEY).toBe('registry/litters')
  })
})
