import { makeScriptedHttp } from '@shared/http/test/scripted-http'
import { describe, expect, it, vi } from 'vitest'

import { makeReloginModel } from './relogin'

const noCredHint = { get: () => null, clear: vi.fn() }

describe('ensureSession', () => {
  it('returns true without a ceremony when the probe says 200', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/session': [{ status: 200, body: {} }] })
    const ceremony = vi.fn()
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: ceremony as never,
      navigate: vi.fn(),
      credHint: noCredHint,
    })
    expect(await model.ensureSession()).toBe(true)
    expect(ceremony).not.toHaveBeenCalled()
  })

  it('runs the ceremony on probe 401 and returns true on verified login', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
      '/api/auth/login/verify': [{ status: 200, body: { accountId: 'a', credentialId: 'c' } }],
    })
    const ceremony = vi.fn(async () => ({ id: 'c' }))
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: ceremony as never,
      navigate: vi.fn(),
      credHint: { get: () => 'hint-1', clear: vi.fn() },
    })

    expect(await model.ensureSession()).toBe(true)
    expect(ceremony).toHaveBeenCalledTimes(1)
    const optionsCall = calls.find((c) => c.url === '/api/auth/login/options')
    expect(optionsCall?.json).toEqual({ credentialIdHint: 'hint-1' })
  })

  it('coalesces concurrent calls into one flight', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/session': [{ status: 200, body: {} }],
    })
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate: vi.fn(),
      credHint: noCredHint,
    })
    const [a, b, c] = await Promise.all([
      model.ensureSession(),
      model.ensureSession(),
      model.ensureSession(),
    ])
    expect([a, b, c]).toEqual([true, true, true])
    expect(calls.length).toBe(1)
  })

  it('redirects to /activate/ and returns false when the ceremony is cancelled', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { options: { challenge: 'x' } } }],
    })
    const navigate = vi.fn()
    const credHint = { get: () => 'hint', clear: vi.fn() }
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn(async () => {
        throw new Error('NotAllowedError')
      }) as never,
      navigate,
      credHint,
    })

    expect(await model.ensureSession()).toBe(false)
    expect(navigate).toHaveBeenCalledWith('/activate/')
    expect(credHint.clear).toHaveBeenCalled()
  })

  it('bails on a malformed login/options envelope', async () => {
    const { http } = makeScriptedHttp({
      '/api/auth/session': [{ status: 401 }],
      '/api/auth/login/options': [{ status: 200, body: { nope: true } }],
    })
    const navigate = vi.fn()
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate,
      credHint: { get: () => 'hint', clear: vi.fn() },
    })
    expect(await model.ensureSession()).toBe(false)
    expect(navigate).toHaveBeenCalledWith('/activate/')
  })

  it('returns false without a ceremony when there is no stored cred hint', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/session': [{ status: 401 }] })
    const ceremony = vi.fn()
    const navigate = vi.fn()
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: ceremony as never,
      navigate,
      credHint: noCredHint,
    })
    expect(await model.ensureSession()).toBe(false)
    expect(ceremony).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('returns false without redirect when the probe network-fails (offline)', async () => {
    const { http } = makeScriptedHttp({ '/api/auth/session': ['network-error'] })
    const navigate = vi.fn()
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate,
      credHint: noCredHint,
    })
    expect(await model.ensureSession()).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('allows a fresh flight after the previous one settles', async () => {
    const { http, calls } = makeScriptedHttp({
      '/api/auth/session': [
        { status: 200, body: {} },
        { status: 200, body: {} },
      ],
    })
    const model = makeReloginModel({
      http,
      startAuthenticationCeremony: vi.fn() as never,
      navigate: vi.fn(),
      credHint: noCredHint,
    })
    await model.ensureSession()
    await model.ensureSession()
    expect(calls.length).toBe(2)
  })
})
