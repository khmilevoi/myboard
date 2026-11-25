// @vitest-environment node
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import type { WidgetEventSchemas } from '@shared/widgets/contracts'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { z } from 'zod'

import { makeModuleApi, ModuleApiError } from './module-api'

const actions = {
  save: { payload: z.object({ value: z.string() }), result: z.object({ id: z.string() }) },
} satisfies WidgetEventSchemas

const URL_SAVE = '/api/modules/notes%2Fmod/actions/save'

const makeApi = (script: Parameters<typeof makeScriptedHttp>[0]) => {
  const { http, calls } = makeScriptedHttp(script)
  return { calls, api: makeModuleApi<typeof actions>({ moduleId: 'notes/mod', http }) }
}

describe('makeModuleApi', () => {
  it('posts { payload } to the encoded action URL and returns typed data', async () => {
    const { api, calls } = makeApi({
      [URL_SAVE]: [{ status: 200, body: { data: { id: 'entry-1' } } }],
    })

    const result = await api.invoke('save', { value: 'hello' })

    expectTypeOf(result).toEqualTypeOf<ModuleApiError | { id: string }>()
    expect(result).toEqual({ id: 'entry-1' })
    expect(calls[0]).toEqual({ method: 'POST', url: URL_SAVE, json: { payload: { value: 'hello' } } })
  })

  it('maps an error envelope to ModuleApiError with its code', async () => {
    const { api } = makeApi({
      [URL_SAVE]: [
        { status: 401, body: { error: { code: 'account_required', message: 'Sign in' } } },
      ],
    })

    const result = await api.invoke('save', { value: 'x' })

    expect(result).toBeInstanceOf(ModuleApiError)
    if (!(result instanceof ModuleApiError)) throw new Error('expected ModuleApiError')
    expect(result.code).toBe('account_required')
    expect(result.meta).toBeUndefined()
  })

  it('uses the network code on transport failure', async () => {
    const { api } = makeApi({ [URL_SAVE]: ['network-error'] })

    const result = await api.invoke('save', { value: 'x' })

    if (!(result instanceof ModuleApiError)) throw new Error('expected ModuleApiError')
    expect(result.code).toBe('network')
    expect(result.cause).toBeDefined()
  })

  it('uses invalid_response on a malformed envelope', async () => {
    const { api } = makeApi({ [URL_SAVE]: [{ status: 200, body: { nonsense: true } }] })

    const result = await api.invoke('save', { value: 'x' })

    if (!(result instanceof ModuleApiError)) throw new Error('expected ModuleApiError')
    expect(result.code).toBe('invalid_response')
  })
})
