export type SerialLane = {
  run<T>(task: () => Promise<T>): Promise<T>
  whenIdle(): Promise<void>
}

export function makeSerialLane(): SerialLane {
  let tail: Promise<unknown> = Promise.resolve()

  function run<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(() => task())
    tail = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  function whenIdle(): Promise<void> {
    return tail.then(
      () => undefined,
      () => undefined,
    )
  }

  return { run, whenIdle }
}

export type KeyedSerialLane = {
  run<T>(key: string, task: () => Promise<T>): Promise<T>
}

export function makeKeyedSerialLane(): KeyedSerialLane {
  const tails = new Map<string, Promise<unknown>>()

  function run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = tails.get(key) ?? Promise.resolve()
    const result = previous.then(() => task())
    const tail = result.then(
      () => undefined,
      () => undefined,
    )

    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })

    return result
  }

  return { run }
}
