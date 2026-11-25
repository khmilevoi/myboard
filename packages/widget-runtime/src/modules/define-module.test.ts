import { defineModuleContract, defineModuleServer } from '@shared/modules/contracts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import {
  type AnyModuleRef,
  bindModule,
  defineModule,
  type ModuleRef,
  type ServerOnlyModel,
} from './define-module'

describe('defineModule', () => {
  it('bindModule stamps the id onto the definition', () => {
    const ref = bindModule('notes', defineModule({ scopes: ['shared'], actions: {} }))
    expect(ref.id).toBe('notes')
    expect(ref.scopes).toEqual(['shared'])
  })

  it('pins the model type from the overloads', () => {
    const withModel = bindModule(
      'a',
      defineModule({ scopes: ['shared'], actions: {}, loadModel: async () => () => ({ n: 1 }) }),
    )
    expectTypeOf(withModel).toExtend<ModuleRef<{}, 'shared', { n: number }>>()
    const without = bindModule('b', defineModule({ scopes: ['shared'], actions: {} }))
    expectTypeOf(without).toExtend<ModuleRef<{}, 'shared', ServerOnlyModel<{}>>>()
    expectTypeOf(without).toExtend<AnyModuleRef>()
  })
})

describe('defineModuleServer', () => {
  it('types context.api.storage by scope', () => {
    const contract = defineModuleContract({
      scopes: ['shared'],
      actions: { ping: { payload: z.object({}), result: z.object({}) } },
    })
    defineModuleServer(contract, {
      handlers: {
        ping: (_payload, context) => {
          expectTypeOf(context.api.storage.shared.get).toBeFunction()
          // @ts-expect-error account scope is not declared by this contract
          void context.api.storage.account
          return {}
        },
      },
    })
  })
})
