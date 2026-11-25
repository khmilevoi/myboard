import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  defineModuleContract,
  defineModuleServer,
  toRuntimeModuleServerDefinition,
} from './contracts'

const contract = defineModuleContract({
  scopes: ['shared'],
  actions: { ping: { payload: z.object({ n: z.number() }), result: z.object({ n: z.number() }) } },
})

describe('module contracts', () => {
  it('defineModuleContract returns the contract unchanged', () => {
    expect(contract.scopes).toEqual(['shared'])
    expect(Object.keys(contract.actions)).toEqual(['ping'])
  })

  it('toRuntimeModuleServerDefinition stamps the module id and defaults crons', () => {
    const handler = async ({ n }: { n: number }) => ({ n })
    const definition = defineModuleServer(contract, { handlers: { ping: handler } })
    const runtime = toRuntimeModuleServerDefinition({ moduleId: 'notes', definition })
    expect(runtime.moduleId).toBe('notes')
    expect(runtime.scopes).toEqual(['shared'])
    expect(runtime.actions).toBe(contract.actions)
    expect(runtime.handlers.ping).toBe(handler)
    expect(runtime.crons).toEqual({})
  })
})
