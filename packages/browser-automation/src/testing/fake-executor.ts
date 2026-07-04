import type { BrowserExecutor } from '../executor'

export type FakeContext = { id: string; signal: AbortSignal }

export type FakeExecutorState = {
  acquired: number
  released: number
  shutdowns: number
  lastSignal: AbortSignal | null
  acquireError: Error | null
}

export function makeFakeExecutor(): {
  executor: BrowserExecutor<FakeContext>
  state: FakeExecutorState
} {
  const state: FakeExecutorState = {
    acquired: 0,
    released: 0,
    shutdowns: 0,
    lastSignal: null,
    acquireError: null,
  }
  const executor: BrowserExecutor<FakeContext> = {
    async acquire(signal) {
      if (state.acquireError) return state.acquireError
      state.acquired += 1
      state.lastSignal = signal
      return { id: `ctx-${state.acquired}`, signal }
    },
    async release() {
      state.released += 1
    },
    async shutdown() {
      state.shutdowns += 1
    },
  }
  return { executor, state }
}
