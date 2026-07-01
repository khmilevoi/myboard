import { describe, expect, it } from 'vitest'

import { runExclusive } from './key-lock'

describe('runExclusive', () => {
  it('serializes tasks for the same key', async () => {
    const order: string[] = []
    let releaseA = () => {}
    const a = runExclusive(
      'k',
      () =>
        new Promise<void>((resolve) => {
          order.push('a-start')
          releaseA = () => {
            order.push('a-end')
            resolve()
          }
        }),
    )
    const b = runExclusive('k', async () => {
      order.push('b-start')
      order.push('b-end')
    })

    await Promise.resolve()
    expect(order).toEqual(['a-start'])

    releaseA()
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b-start', 'b-end'])
  })

  it('runs different keys concurrently', async () => {
    const order: string[] = []
    let releaseA = () => {}
    const a = runExclusive(
      'a',
      () =>
        new Promise<void>((resolve) => {
          order.push('a-start')
          releaseA = resolve
        }),
    )
    const b = runExclusive('b', async () => {
      order.push('b-ran')
    })

    await b
    expect(order).toEqual(['a-start', 'b-ran'])

    releaseA()
    await a
  })

  it('does not let a rejecting task block the next one for the same key', async () => {
    const failed = runExclusive('k', async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')

    const next = await runExclusive('k', async () => 'ok')
    expect(next).toBe('ok')
  })
})
