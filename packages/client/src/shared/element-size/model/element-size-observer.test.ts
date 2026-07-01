// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Entry = { target: Element; contentRect: { width: number; height: number } }
type Callback = (entries: Entry[]) => void

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed = new Set<Element>()
  constructor(public callback: Callback) {
    FakeResizeObserver.instances.push(this)
  }
  observe(element: Element) {
    this.observed.add(element)
  }
  unobserve(element: Element) {
    this.observed.delete(element)
  }
  disconnect() {
    this.observed.clear()
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  vi.stubGlobal('ResizeObserver', FakeResizeObserver)
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0)
    return 0
  })
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('observeElementSize', () => {
  it('shares a single ResizeObserver instance across multiple elements', async () => {
    const { observeElementSize } = await import('./element-size-observer')
    const elementA = document.createElement('div')
    const elementB = document.createElement('div')

    observeElementSize(elementA, () => {})
    observeElementSize(elementB, () => {})

    expect(FakeResizeObserver.instances).toHaveLength(1)
    expect(FakeResizeObserver.instances[0].observed).toEqual(new Set([elementA, elementB]))
  })

  it('notifies only the listener for the element that resized', async () => {
    const { observeElementSize } = await import('./element-size-observer')
    const elementA = document.createElement('div')
    const elementB = document.createElement('div')
    const listenerA = vi.fn()
    const listenerB = vi.fn()

    observeElementSize(elementA, listenerA)
    observeElementSize(elementB, listenerB)

    const observer = FakeResizeObserver.instances[0]
    observer.callback([{ target: elementA, contentRect: { width: 320, height: 280 } }])

    expect(listenerA).toHaveBeenCalledExactlyOnceWith({ width: 320, height: 280 })
    expect(listenerB).not.toHaveBeenCalled()
  })

  it('stops notifying and unobserves after the returned cleanup runs', async () => {
    const { observeElementSize } = await import('./element-size-observer')
    const element = document.createElement('div')
    const listener = vi.fn()

    const stop = observeElementSize(element, listener)
    stop()

    const observer = FakeResizeObserver.instances[0]
    expect(observer.observed.has(element)).toBe(false)

    observer.callback([{ target: element, contentRect: { width: 100, height: 100 } }])
    expect(listener).not.toHaveBeenCalled()
  })
})
