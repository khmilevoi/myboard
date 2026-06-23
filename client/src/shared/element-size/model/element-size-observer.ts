export type ElementSize = { width: number; height: number }

type Listener = (size: ElementSize) => void

let sharedObserver: ResizeObserver | null = null
let rafId: number | null = null
let pendingEntries: ResizeObserverEntry[] = []
const listeners = new Map<Element, Listener>()

function flush() {
  rafId = null
  const entries = pendingEntries
  pendingEntries = []
  for (const entry of entries) {
    listeners.get(entry.target)?.({
      width: entry.contentRect.width,
      height: entry.contentRect.height,
    })
  }
}

function getSharedObserver(): ResizeObserver {
  if (!sharedObserver) {
    sharedObserver = new ResizeObserver((entries) => {
      pendingEntries.push(...entries)
      if (rafId === null) rafId = requestAnimationFrame(flush)
    })
  }
  return sharedObserver
}

// All widget cards observe through one ResizeObserver instance instead of
// one each — the browser already batches measurement across every observed
// element into a single pass per frame, so a shared instance costs the same
// as N separate ones while creating far fewer native objects.
export function observeElementSize(element: Element, listener: Listener): () => void {
  listeners.set(element, listener)
  getSharedObserver().observe(element)

  return () => {
    listeners.delete(element)
    getSharedObserver().unobserve(element)
  }
}
