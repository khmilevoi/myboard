import { context, wrap } from '@reatom/core'

import { makeRecoveryModel, recoverySocketUrl } from './recovery-model'
import {
  RecoveryIssueError,
  type RecoveryIssue,
  type RecoveryTransport,
} from './recovery-transport'
import type { RfbLike } from './rfb'

class FakeRfb implements RfbLike {
  listeners = new Map<string, Set<(event: Event) => void>>()
  disconnectCalls = 0

  constructor(public url: string) {}

  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  disconnect() {
    this.disconnectCalls += 1
  }

  emit(type: string) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot listeners before invoking them so a handler that (un)registers a listener mid-emit can't mutate the set we're iterating.
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type))
  }
}

function makeFakes(results: Array<RecoveryIssueError | RecoveryIssue>) {
  const issueCalls: string[] = []
  const transport: RecoveryTransport = {
    issue: async (widgetId) => {
      issueCalls.push(widgetId)
      const next = results.shift()
      if (!next) throw new Error('unexpected issue call')
      return next
    },
  }
  const rfbs: FakeRfb[] = []
  const makeRfb = (_target: HTMLElement, url: string) => {
    const rfb = new FakeRfb(url)
    rfbs.push(rfb)
    return rfb
  }
  return { transport, makeRfb, issueCalls, rfbs }
}

const LOCATION = { protocol: 'https:', host: 'board.test' }

function makeModel(fakes: ReturnType<typeof makeFakes>, nowMs?: () => number) {
  return makeRecoveryModel({
    widgetId: 'passport-checker',
    transport: fakes.transport,
    makeRfb: fakes.makeRfb,
    location: LOCATION,
    ...(nowMs ? { nowMs } : {}),
  })
}

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

describe('recoverySocketUrl', () => {
  it('builds wss for https and ws for http', () => {
    expect(recoverySocketUrl({ protocol: 'https:', host: 'a.b' })).toBe(
      'wss://a.b/api/browser/recovery/socket',
    )
    expect(recoverySocketUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/api/browser/recovery/socket',
    )
  })
})

describe('makeRecoveryModel', () => {
  it('issues, connects and reflects RFB connect', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))

      expect(fakes.issueCalls).toEqual(['passport-checker'])
      expect(read()).toEqual({ kind: 'connecting', expiresInMs: 60_000 })
      expect(fakes.rfbs[0]?.url).toBe('wss://board.test/api/browser/recovery/socket')

      fakes.rfbs[0]?.emit('connect')
      expect(read()).toEqual({ kind: 'connected', expiresInMs: 60_000 })
    })
  })

  it.each([
    [new RecoveryIssueError({ code: 'recovery_unavailable' }), 'unavailable'],
    [new RecoveryIssueError({ code: 'recovery_busy' }), 'busy'],
    [new RecoveryIssueError({ code: 'automation_unavailable' }), 'automationDown'],
    [new RecoveryIssueError({ code: 'network' }), 'automationDown'],
  ])('maps an issue error to %s', async (error, kind) => {
    const fakes = makeFakes([error])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))

      expect(read()).toEqual({ kind })
      expect(fakes.rfbs).toHaveLength(0)
    })

    warn.mockRestore()
  })

  it('drops to disconnected on RFB disconnect and reissues on reconnect', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }, { expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const readRemaining = wrap(() => model.remainingMs())
      const start = wrap((el: HTMLElement) => model.start(el))
      const target = document.createElement('div')

      await start(target)
      fakes.rfbs[0]?.emit('connect')
      fakes.rfbs[0]?.emit('disconnect')
      expect(read()).toEqual({ kind: 'disconnected' })
      expect(readRemaining()).toBe(0)
      expect(fakes.rfbs[0]?.disconnectCalls).toBe(1)

      await start(target)
      expect(fakes.issueCalls).toHaveLength(2)
      expect(read()).toEqual({ kind: 'connecting', expiresInMs: 60_000 })
    })
  })

  it('maps securityfailure to disconnected', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))
      fakes.rfbs[0]?.emit('securityfailure')

      expect(read()).toEqual({ kind: 'disconnected' })
    })

    warn.mockRestore()
  })

  it('counts down and expires the session at zero', async () => {
    vi.useFakeTimers()
    const fakes = makeFakes([{ expiresInMs: 2_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const readRemaining = wrap(() => model.remainingMs())
      const start = wrap((el: HTMLElement) => model.start(el))

      await start(document.createElement('div'))
      fakes.rfbs[0]?.emit('connect')
      expect(readRemaining()).toBe(2_000)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(readRemaining()).toBe(1_000)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(read()).toEqual({ kind: 'expired' })
      expect(readRemaining()).toBe(0)
      expect(fakes.rfbs[0]?.disconnectCalls).toBe(1)
    })
  })

  it('supersedes a stale attempt: old RFB events are ignored, old session disposed', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }, { expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const read = wrap(() => model.state())
      const start = wrap((el: HTMLElement) => model.start(el))
      const target = document.createElement('div')

      await start(target)
      const firstRfb = fakes.rfbs[0]

      await start(target)
      expect(firstRfb?.disconnectCalls).toBe(1)

      firstRfb?.emit('disconnect')
      expect(read()).toEqual({ kind: 'connecting', expiresInMs: 60_000 })
    })
  })

  it('tears down exactly once', async () => {
    const fakes = makeFakes([{ expiresInMs: 60_000 }])

    await context.start(async () => {
      const model = makeModel(fakes)
      const start = wrap((el: HTMLElement) => model.start(el))
      const teardown = wrap(() => model.teardown())

      await start(document.createElement('div'))
      teardown()
      teardown()

      expect(fakes.rfbs[0]?.disconnectCalls).toBe(1)
    })
  })
})
