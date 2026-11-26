import { describe, expect, it } from 'vitest'

import { createMemoryOps, createMemoryPubSub } from '../test/memory-ops'
import { makeModuleServerStorage } from './api'

describe('makeModuleServerStorage', () => {
  const setup = (scopes: readonly ('shared' | 'account')[]) => {
    const ops = createMemoryOps(createMemoryPubSub())
    const storage = makeModuleServerStorage({
      ops,
      moduleId: 'notes',
      scopes,
      viewer: { accountId: 'acc1' } as never,
      now: () => 1,
    })
    return { ops, storage }
  }

  it('writes shared and account scopes under module namespaces', async () => {
    const { ops, storage } = setup(['shared', 'account'])
    expect(await storage.shared?.set('k', 1)).toBeUndefined()
    expect(await storage.account?.set('k', 2)).toBeUndefined()
    expect(await ops.get('m:notes:s:k')).toBe('1')
    expect(await ops.get('m:notes:a:acc1:k')).toBe('2')
  })

  it('omits undeclared scopes', () => {
    const { storage } = setup(['shared'])
    expect('account' in storage).toBe(false)
    expect('shared' in storage).toBe(true)
  })
})
