import { makeSerialLane } from '@shared/async/serial-lane'
import * as errore from 'errore'

import { AutomationTimeoutError } from './errors'

export class ExecutionAbortError extends errore.createTaggedError({
  name: 'ExecutionAbortError',
  message: 'Browser task aborted after execution deadline',
  extends: errore.AbortError,
}) {}

export type QueueConfig = { queueWaitMs: number; executionMs: number }

export type SingleLaneQueue = {
  enqueue<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | Error>
  close(makeError: () => Error): void
  whenSettled(): Promise<void>
}

export function makeSingleLaneQueue(config: QueueConfig): SingleLaneQueue {
  const lane = makeSerialLane()
  let closed = false
  let makeCloseError: (() => Error) | null = null

  function enqueue<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T | Error> {
    if (closed && makeCloseError) return Promise.resolve(makeCloseError())
    return new Promise<T | Error>((resolve) => {
      let settled = false
      const settle = (value: T | Error) => {
        if (settled) return
        settled = true
        resolve(value)
      }
      const waitTimer = setTimeout(
        () => settle(new AutomationTimeoutError({ phase: 'queue' })),
        config.queueWaitMs,
      )

      // makeSerialLane guarantees one-at-a-time FIFO and waits for each task to
      // settle before the next; the deadline/abort/close logic stays here.
      void lane.run(async () => {
        clearTimeout(waitTimer)
        if (settled) return
        if (closed && makeCloseError) {
          settle(makeCloseError())
          return
        }
        const controller = new AbortController()
        const execTimer = setTimeout(() => {
          controller.abort(new ExecutionAbortError())
          settle(new AutomationTimeoutError({ phase: 'execution' }))
        }, config.executionMs)
        const outcome = await run(controller.signal).catch((cause) =>
          cause instanceof Error ? cause : new Error('browser task rejected', { cause }),
        )
        clearTimeout(execTimer)
        settle(outcome)
      })
    })
  }

  function close(makeError: () => Error) {
    closed = true
    makeCloseError = makeError
  }

  function whenSettled() {
    return lane.whenIdle()
  }

  return { enqueue, close, whenSettled }
}
