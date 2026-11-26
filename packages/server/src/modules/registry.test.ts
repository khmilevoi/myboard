import type { RuntimeModuleServerDefinition } from '@shared/modules/contracts'
import { describe, expect, it } from 'vitest'

import { InvalidCronScheduleError } from '../widgets/errors'
import { DuplicateModuleError, ModuleCronWithoutSharedScopeError } from './errors'
import { makeModuleServerRegistry } from './registry'

const base: RuntimeModuleServerDefinition = {
  moduleId: 'notes',
  scopes: ['shared'],
  actions: {},
  handlers: {},
  crons: {},
}

const cron = { schedule: '* * * * *', timeZone: 'UTC', run: () => undefined }

describe('module server registry', () => {
  it('registers definitions by module id', () => {
    const registry = makeModuleServerRegistry([base])
    if (registry instanceof Error) throw registry
    expect(registry.get('notes')).toBe(base)
  })

  it('rejects duplicate module ids', () => {
    expect(makeModuleServerRegistry([base, base])).toBeInstanceOf(DuplicateModuleError)
  })

  it('rejects an invalid cron schedule', () => {
    const result = makeModuleServerRegistry([
      { ...base, crons: { tick: { ...cron, schedule: 'not a cron' } } },
    ])
    expect(result).toBeInstanceOf(InvalidCronScheduleError)
  })

  it('rejects crons on a module without the shared scope', () => {
    const result = makeModuleServerRegistry([
      { ...base, scopes: ['account'], crons: { tick: cron } },
    ])
    expect(result).toBeInstanceOf(ModuleCronWithoutSharedScopeError)
  })
})
