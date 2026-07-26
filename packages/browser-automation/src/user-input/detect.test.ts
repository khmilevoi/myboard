import type { Page } from 'playwright'
import { describe, expect, it, vi } from 'vitest'

import { makeDetectUserInput } from './detect'
import { UserInputProbeError, UserInputRequiredError } from './errors'

function fakePage(): Page {
  return {} as unknown as Page
}

describe('makeDetectUserInput', () => {
  it('returns null and calls neither prepare nor retain when the detector declines', async () => {
    const retain = vi.fn()
    const prepare = vi.fn(async () => undefined)
    const detectUserInput = makeDetectUserInput({
      page: fakePage(),
      recoverySshTarget: null,
      retain,
    })

    const result = await detectUserInput(async () => false, { prepare })

    expect(result).toBeNull()
    expect(prepare).not.toHaveBeenCalled()
    expect(retain).not.toHaveBeenCalled()
  })

  // This is the ordering contract the whole extraction exists to protect: a
  // human must be able to act on the page (prepare finished) before it is
  // pinned open for them (retain). Asserting through the executor's
  // hasRetainedPage() cannot distinguish this from the reverse order, because
  // that bookkeeping is only populated later, at release() — so the order is
  // asserted here directly against the two injected callbacks instead.
  it('runs prepare to completion before calling retain', async () => {
    const order: string[] = []
    const retain = vi.fn(() => {
      order.push('retain')
    })
    const prepare = vi.fn(async () => {
      order.push('prepare-start')
      await Promise.resolve()
      order.push('prepare-end')
    })
    const detectUserInput = makeDetectUserInput({
      page: fakePage(),
      recoverySshTarget: null,
      retain,
    })

    const result = await detectUserInput(async () => true, { prepare })

    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect(order).toEqual(['prepare-start', 'prepare-end', 'retain'])
  })

  it('still calls retain after a failed prepare, and logs the failure', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const order: string[] = []
    const retain = vi.fn(() => order.push('retain'))
    const prepare = vi.fn(async () => {
      order.push('prepare')
      throw new Error('prepare failed')
    })
    const detectUserInput = makeDetectUserInput({
      page: fakePage(),
      recoverySshTarget: null,
      retain,
    })

    const result = await detectUserInput(async () => true, { prepare })

    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect(order).toEqual(['prepare', 'retain'])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('calls retain and skips prepare when no prepare hook is given', async () => {
    const retain = vi.fn()
    const detectUserInput = makeDetectUserInput({
      page: fakePage(),
      recoverySshTarget: 'pi@myboard.local',
      retain,
    })

    const result = await detectUserInput(async () => true)

    expect(retain).toHaveBeenCalledOnce()
    expect(result).toBeInstanceOf(UserInputRequiredError)
    expect((result as UserInputRequiredError).sshTarget).toBe('pi@myboard.local')
  })

  it('wraps a detector failure as a probe error without calling prepare or retain', async () => {
    const retain = vi.fn()
    const prepare = vi.fn(async () => undefined)
    const detectUserInput = makeDetectUserInput({
      page: fakePage(),
      recoverySshTarget: null,
      retain,
    })

    const result = await detectUserInput(async () => new Error('probe failed'), { prepare })

    expect(result).toBeInstanceOf(UserInputProbeError)
    expect(prepare).not.toHaveBeenCalled()
    expect(retain).not.toHaveBeenCalled()
  })

  it('hands the same page to both the detector and prepare', async () => {
    const page = fakePage()
    const detector = vi.fn(async () => true)
    const prepare = vi.fn(async () => undefined)
    const detectUserInput = makeDetectUserInput({
      page,
      recoverySshTarget: null,
      retain: () => undefined,
    })

    await detectUserInput(detector, { prepare })

    expect(detector).toHaveBeenCalledWith(page)
    expect(prepare).toHaveBeenCalledWith(page)
  })
})
