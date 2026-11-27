import { ConsentCodeSchema } from '@shared/hardware/spike-assumptions'
import { afterEach, describe, expect, it, vi } from 'vitest'

const randomInt = vi.hoisted(() => vi.fn())

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>()
  randomInt.mockImplementation(actual.randomInt)
  return { ...actual, randomInt }
})

const { generateConsentCode } = await import('./consent-code')

afterEach(() => {
  randomInt.mockClear()
})

describe('generateConsentCode', () => {
  it('always produces a code the consent-code schema accepts', () => {
    for (let i = 0; i < 1_000; i += 1) {
      expect(ConsentCodeSchema.safeParse(generateConsentCode()).success).toBe(true)
    }
  })

  it('left-pads a small number to the full code width', () => {
    randomInt.mockReturnValueOnce(42)
    expect(generateConsentCode()).toBe('0042')
    expect(randomInt).toHaveBeenLastCalledWith(0, 10_000)
  })
})
