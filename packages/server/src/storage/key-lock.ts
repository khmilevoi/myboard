import { makeKeyedSerialLane } from '@shared/async/serial-lane'

/**
 * In-process per-key serialization. Each task waits for the previous task on the
 * same key to settle; different keys are independent.
 */
const lane = makeKeyedSerialLane()

export function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  return lane.run(key, task)
}
