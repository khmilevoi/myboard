import { context } from '@reatom/core'
import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAddGatewayModel } from './add-gateway-model'
import { GENERIC_ACTION_ERROR_COPY } from './hardware-copy'
import { makeHardwareModel } from './hardware-model'

beforeEach(() =>
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] }),
)
afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

const NOW = 1_800_000_000_000
const CODE_TTL_MS = 300_000

const gateway = (id: string, online: boolean): HardwareSnapshot['gateways'][number] => ({
  id,
  label: id,
  online,
  lastSeenAt: NOW,
  connectedAt: online ? NOW : null,
  adapterPowered: true,
  scan: null,
  bondedNotAdopted: [],
})

const snap = (...gateways: HardwareSnapshot['gateways']): HardwareSnapshot => ({
  gateways,
  hardware: [],
})

const mintStep = (expiresAt = NOW + CODE_TTL_MS): ScriptedStep => ({
  status: 201,
  body: { code: 'ABCD-1234', expiresAt },
})

function setup(options: {
  snapshots: HardwareSnapshot[]
  mints?: ScriptedStep[]
  clipboard?: { writeText: (text: string) => Promise<void> }
}) {
  const { http, calls } = makeScriptedHttp({
    '/api/hardware': options.snapshots.map((body) => ({ status: 200, body })),
    '/api/hardware/codes': options.mints ?? [mintStep()],
  })
  const { open } = makeFakeOpenEventStream()
  const client = makeHardwareBoardClient(http)
  let nowMs = NOW
  const hardware = makeHardwareModel({ client, openEventStream: open, now: () => nowMs })
  const model = makeAddGatewayModel({ hardware, client, clipboard: options.clipboard })
  // Keeps the snapshot connected, as the open dialog does.
  const unsubscribe = model.phase.subscribe(() => {})
  const loaded = () => vi.waitFor(() => expect(hardware.snapshot.data()).not.toBeNull())
  const tick = (ms: number) => {
    nowMs += ms
    hardware.clock.set(nowMs)
  }
  return { model, hardware, calls, loaded, tick, unsubscribe }
}

describe('add-gateway model', () => {
  it('start mints and shows the code with «4:52» remaining', async () => {
    const env = setup({ snapshots: [snap()] })
    await env.loaded()

    await env.model.start()
    env.tick(8_000)

    expect(env.model.code()).toBe('ABCD-1234')
    expect(env.model.countdownLabel()).toBe('4:52')
    expect(env.model.phase()).toBe('waiting')
  })

  it('a new online gateway in the snapshot flips to connected', async () => {
    const env = setup({
      snapshots: [snap(gateway('g1', true)), snap(gateway('g1', true), gateway('g2', true))],
    })
    await env.loaded()
    await env.model.start()

    env.hardware.refresh()
    await vi.waitFor(() => expect(env.model.phase()).toBe('connected'))
  })

  it('a gateway that was already there does not', async () => {
    const env = setup({ snapshots: [snap(gateway('g1', false)), snap(gateway('g1', true))] })
    await env.loaded()
    await env.model.start()

    env.hardware.refresh()
    await vi.waitFor(() => expect(env.hardware.snapshot.data()?.gateways[0]?.online).toBe(true))
    expect(env.model.phase()).toBe('waiting')
  })

  it('a new gateway still offline stays waiting', async () => {
    const env = setup({ snapshots: [snap(), snap(gateway('g2', false))] })
    await env.loaded()
    await env.model.start()

    env.hardware.refresh()
    await vi.waitFor(() => expect(env.hardware.snapshot.data()?.gateways).toHaveLength(1))
    expect(env.model.phase()).toBe('waiting')
  })

  it('the clock passing expiresAt → expired; start again mints a new code', async () => {
    const env = setup({
      snapshots: [snap()],
      mints: [
        mintStep(),
        { status: 201, body: { code: 'WXYZ-9999', expiresAt: NOW + 2 * CODE_TTL_MS } },
      ],
    })
    await env.loaded()
    await env.model.start()

    env.tick(CODE_TTL_MS)
    expect(env.model.phase()).toBe('expired')
    expect(env.model.countdownLabel()).toBe('0:00')

    await env.model.start()
    expect(env.model.code()).toBe('WXYZ-9999')
    expect(env.model.phase()).toBe('waiting')
  })

  it('mint failure → failed with describeHardwareError copy', async () => {
    const env = setup({ snapshots: [snap()], mints: [{ status: 500 }] })
    await env.loaded()

    await env.model.start()

    expect(env.model.phase()).toBe('failed')
    expect(env.model.error()).toBe(GENERIC_ACTION_ERROR_COPY)
    expect(env.model.code()).toBeNull()
  })

  it('copy writes the code and sets copied for 2 s', async () => {
    const writeText = vi.fn(async (_text: string) => {})
    const env = setup({ snapshots: [snap()], clipboard: { writeText } })
    await env.loaded()
    await env.model.start()

    const copying = env.model.copy()
    await vi.advanceTimersByTimeAsync(0)
    expect(writeText).toHaveBeenCalledWith('ABCD-1234')
    expect(env.model.copied()).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    await copying
    expect(env.model.copied()).toBe(false)
  })

  it('a clipboard failure leaves the label alone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const env = setup({
      snapshots: [snap()],
      clipboard: { writeText: () => Promise.reject(new Error('denied')) },
    })
    await env.loaded()
    await env.model.start()

    await env.model.copy()

    expect(env.model.copied()).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('the countdown uses the injected server clock, not Date.now()', async () => {
    // The server clock is 10 min behind the browser's: expiresAt is still ahead on it.
    vi.setSystemTime(NOW + 600_000)
    const env = setup({ snapshots: [snap()] })
    await env.loaded()
    await env.model.start()

    expect(env.model.phase()).toBe('waiting')
    expect(env.model.countdownLabel()).toBe('5:00')
  })

  it('reset clears the code and error', async () => {
    const env = setup({ snapshots: [snap()] })
    await env.loaded()
    await env.model.start()

    env.model.reset()

    expect(env.model.code()).toBeNull()
    expect(env.model.error()).toBeNull()
  })
})
