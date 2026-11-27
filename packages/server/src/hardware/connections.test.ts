import { EventEmitter } from 'node:events'
import type { ServerResponse } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeGatewayConnections } from './connections'

type FakeRes = ServerResponse & { written: string[]; ended: boolean }

function fakeRes(): FakeRes {
  const res = new EventEmitter() as unknown as FakeRes
  res.written = []
  res.ended = false
  res.write = ((chunk: string) => {
    res.written.push(chunk)
    return true
  }) as FakeRes['write']
  res.end = (() => {
    res.ended = true
    return res
  }) as FakeRes['end']
  return res
}

const command = { id: 'c1', type: 'scan.stop' } as const

afterEach(() => {
  vi.useRealTimers()
})

describe('makeGatewayConnections', () => {
  it('sends commands only while attached', () => {
    const connections = makeGatewayConnections()
    expect(connections.send('g1', command)).toBe(false)
    const res = fakeRes()
    connections.attach('g1', res)
    expect(connections.isOnline('g1')).toBe(true)
    expect(connections.send('g1', command)).toBe(true)
    expect(res.written.join('')).toBe(`event: command\ndata: ${JSON.stringify(command)}\n\n`)
    connections.detach('g1', res)
    expect(connections.isOnline('g1')).toBe(false)
  })

  it('a second attach ends the first stream and only the second receives commands', () => {
    const connections = makeGatewayConnections()
    const first = fakeRes()
    const second = fakeRes()
    connections.attach('g1', first)
    connections.attach('g1', second)
    expect(first.ended).toBe(true)
    // The first stream's own close handler detaches it: that must not unplug the second.
    connections.detach('g1', first)
    expect(connections.isOnline('g1')).toBe(true)
    connections.send('g1', command)
    expect(first.written).toEqual([])
    expect(second.written.join('')).toContain('event: command\n')
  })

  it('pings every 25 s and stops once closed', () => {
    vi.useFakeTimers()
    const connections = makeGatewayConnections()
    const res = fakeRes()
    connections.attach('g1', res)
    vi.advanceTimersByTime(25_000)
    expect(res.written).toEqual([': ping\n\n'])
    connections.close('g1')
    expect(res.ended).toBe(true)
    expect(connections.isOnline('g1')).toBe(false)
    vi.advanceTimersByTime(50_000)
    expect(res.written).toEqual([': ping\n\n'])
  })

  it('closeAll ends every stream', () => {
    vi.useFakeTimers()
    const connections = makeGatewayConnections()
    const a = fakeRes()
    const b = fakeRes()
    connections.attach('g1', a)
    connections.attach('g2', b)
    connections.closeAll()
    expect(a.ended && b.ended).toBe(true)
    expect(connections.isOnline('g1') || connections.isOnline('g2')).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })
})
