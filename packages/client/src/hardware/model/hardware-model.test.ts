import { addCallHook, context } from '@reatom/core'
import type { HardwareBoardEvent, HardwareSnapshot } from '@shared/hardware/board-api'
import { HARDWARE_EVENTS_KEY } from '@shared/hardware/board-api'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import type { BleAddress } from '@shared/hardware/models'
import { CONSENT_CODE_DIGITS } from '@shared/hardware/spike-assumptions'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeHardwareModel } from './hardware-model'

afterEach(() => context.reset())

const NOW = 1_800_000_000_000
const ADDRESS = 'AA:BB:CC:DD:EE:FF' as BleAddress

const snapshot: HardwareSnapshot = {
  gateways: [
    {
      id: 'g1',
      label: 'Кухня',
      online: true,
      lastSeenAt: NOW,
      connectedAt: NOW - 3_600_000,
      adapterPowered: true,
      scan: null,
      bondedNotAdopted: [],
    },
  ],
  hardware: [
    {
      id: 'h1',
      gatewayId: 'g1',
      model: 'beurer-bf950',
      address: ADDRESS,
      battery: 80,
      lastReadingAt: null,
      profiles: [{ index: 1, binding: 'mine' }],
    },
  ],
}

const snapshotSteps = (count: number): ScriptedStep[] =>
  Array.from({ length: count }, () => ({ status: 200, body: snapshot }))

function setup(script: Record<string, ScriptedStep[]> = {}) {
  const { http, calls } = makeScriptedHttp({ '/api/hardware': snapshotSteps(5), ...script })
  const { open, streams } = makeFakeOpenEventStream()
  const model = makeHardwareModel({
    client: makeHardwareBoardClient(http),
    openEventStream: open,
    now: () => NOW,
  })
  const snapshotGets = () => calls.filter((c) => c.method === 'GET' && c.url === '/api/hardware')
  return { model, calls, streams, snapshotGets }
}

async function connected(setupResult: ReturnType<typeof setup>) {
  const unsubscribe = setupResult.model.snapshot.subscribe(() => {})
  await vi.waitFor(() => expect(setupResult.model.snapshot.data()).not.toBeNull())
  return unsubscribe
}

const frame = (value: unknown) => ({ key: HARDWARE_EVENTS_KEY, value })

describe('snapshot and the live stream', () => {
  it('connecting opens one stream to /api/hardware/events and loads the snapshot', async () => {
    const env = setup()
    await connected(env)

    expect(env.streams).toHaveLength(1)
    expect(env.streams[0]!.url).toBe('/api/hardware/events')
    expect(env.streams[0]!.handlers.events).toEqual(['ready'])
    expect(env.model.snapshot.data()).toEqual(snapshot)
    expect(env.model.window()?.attached).toHaveLength(1)
    expect(env.snapshotGets()).toHaveLength(1)
  })

  it('a changed frame refetches the snapshot', async () => {
    const env = setup()
    await connected(env)

    env.streams[0]!.emit(undefined, frame({ type: 'changed' }))

    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('a ready frame (reconnect) refetches', async () => {
    const env = setup()
    await connected(env)

    env.streams[0]!.emit('ready', {})

    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('a pairing frame reaches received without a refetch', async () => {
    const env = setup()
    await connected(env)
    const seen: HardwareBoardEvent[] = []
    addCallHook(env.model.received, (event) => seen.push(event))

    const pairing = {
      type: 'pairing',
      pairingId: 'p1',
      stage: 'pin_required',
      hardwareId: null,
      reason: null,
    }
    env.streams[0]!.emit(undefined, frame(pairing))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(seen).toEqual([pairing])
    expect(env.snapshotGets()).toHaveLength(1)
  })

  it('unsubscribing closes the stream', async () => {
    const env = setup()
    const unsubscribe = await connected(env)

    unsubscribe()

    await vi.waitFor(() => expect(env.streams[0]!.closed).toBe(true))
  })
})

describe('confirmAction', () => {
  it('confirmAction for revokeGateway DELETEs /api/hardware/gateways/g1, clears confirm and refetches', async () => {
    const env = setup({ '/api/hardware/gateways/g1': [{ status: 204 }] })
    await connected(env)
    env.model.confirm.set({ kind: 'revokeGateway', gatewayId: 'g1' })

    await env.model.confirmAction()

    expect(env.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', url: '/api/hardware/gateways/g1' }),
    )
    expect(env.model.confirm()).toBeNull()
    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('confirmAction for unpair DELETEs /api/hardware/items/h1, clears confirm and refetches', async () => {
    const env = setup({ '/api/hardware/items/h1': [{ status: 204 }] })
    await connected(env)
    env.model.confirm.set({ kind: 'unpair', hardwareId: 'h1' })

    await env.model.confirmAction()

    expect(env.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', url: '/api/hardware/items/h1' }),
    )
    expect(env.model.confirm()).toBeNull()
    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('confirmAction for removeDetached DELETEs /api/hardware/items/h1, clears confirm and refetches', async () => {
    const env = setup({ '/api/hardware/items/h1': [{ status: 204 }] })
    await connected(env)
    env.model.confirm.set({ kind: 'removeDetached', hardwareId: 'h1' })

    await env.model.confirmAction()

    expect(env.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', url: '/api/hardware/items/h1' }),
    )
    expect(env.model.confirm()).toBeNull()
    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('confirmAction for unbind DELETEs /api/hardware/items/h1/profiles/1, clears confirm and refetches', async () => {
    const env = setup({ '/api/hardware/items/h1/profiles/1': [{ status: 204 }] })
    await connected(env)
    env.model.confirm.set({ kind: 'unbind', hardwareId: 'h1', index: 1 })

    await env.model.confirmAction()

    expect(env.calls).toContainEqual(
      expect.objectContaining({ method: 'DELETE', url: '/api/hardware/items/h1/profiles/1' }),
    )
    expect(env.model.confirm()).toBeNull()
    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('a 409 gateway_offline on unpair sets actionError «Шлюз не в сети.» and keeps the confirm open', async () => {
    const env = setup({
      '/api/hardware/items/h1': [
        { status: 409, body: { error: { code: 'gateway_offline', message: 'offline' } } },
      ],
    })
    await connected(env)
    env.model.confirm.set({ kind: 'unpair', hardwareId: 'h1' })

    await env.model.confirmAction()

    expect(env.model.actionError()).toBe('Шлюз не в сети.')
    expect(env.model.confirm()).toEqual({ kind: 'unpair', hardwareId: 'h1' })
  })

  it('any other failure sets the generic actionError', async () => {
    const env = setup({ '/api/hardware/gateways/g1': [{ status: 500 }] })
    await connected(env)
    env.model.confirm.set({ kind: 'revokeGateway', gatewayId: 'g1' })

    await env.model.confirmAction()

    expect(env.model.actionError()).toBe('Не получилось. Попробуйте ещё раз.')
  })
})

describe('inline rows', () => {
  it('revealCode stores the code; hideCode clears it; opening a confirm clears revealed', async () => {
    const consentCode = '1'.repeat(CONSENT_CODE_DIGITS)
    const env = setup({
      '/api/hardware/items/h1/profiles/1/consent-code': [
        { status: 200, body: { consentCode } },
        { status: 200, body: { consentCode } },
      ],
    })
    await connected(env)

    await env.model.revealCode('h1', 1)
    expect(env.model.revealed()).toEqual({ hardwareId: 'h1', index: 1, consentCode })

    env.model.hideCode()
    expect(env.model.revealed()).toBeNull()

    await env.model.revealCode('h1', 1)
    env.model.confirm.set({ kind: 'unbind', hardwareId: 'h1', index: 1 })
    expect(env.model.revealed()).toBeNull()
  })

  it('adopt POSTs { address } to /api/hardware/gateways/g1/adopt', async () => {
    const env = setup({
      '/api/hardware/gateways/g1/adopt': [{ status: 200, body: { hardwareId: 'h1' } }],
    })
    await connected(env)

    await env.model.adopt('g1', ADDRESS)

    expect(env.calls).toContainEqual({
      method: 'POST',
      url: '/api/hardware/gateways/g1/adopt',
      json: { address: ADDRESS },
      body: undefined,
      headers: undefined,
    })
    await vi.waitFor(() => expect(env.snapshotGets()).toHaveLength(2))
  })

  it('reset returns to the list with nothing open', async () => {
    const env = setup()
    env.model.view.set('wizard')
    env.model.confirm.set({ kind: 'unpair', hardwareId: 'h1' })
    env.model.actionError.set('Шлюз не в сети.')

    env.model.reset()

    expect(env.model.view()).toBe('list')
    expect(env.model.confirm()).toBeNull()
    expect(env.model.revealed()).toBeNull()
    expect(env.model.actionError()).toBeNull()
  })
})
