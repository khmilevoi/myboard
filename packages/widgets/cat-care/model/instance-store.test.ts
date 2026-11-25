import { describe, expect, it, vi } from 'vitest'

import { catCareInstance, type CatCareInstanceModels } from './instance-store'

describe('cat care tile/fullscreen state', () => {
  it('shares drafts between two mounts but isolates a second cat', () => {
    const first = {
      model: { name: 'first' },
      forms: { draft: '30' },
    } as unknown as CatCareInstanceModels
    const second = {
      model: { name: 'second' },
      forms: { draft: '20' },
    } as unknown as CatCareInstanceModels
    const make = vi.fn(() => first)
    const tile = catCareInstance('first-cat', make)
    const tileOff = tile.subscribe(() => {})
    const fullscreen = catCareInstance('first-cat', make)
    const fullOff = fullscreen.subscribe(() => {})
    const another = catCareInstance('second-cat', () => second)
    const anotherOff = another.subscribe(() => {})
    expect(tile()).toBe(first)
    expect(fullscreen()).toBe(first)
    expect(another()).toBe(second)
    expect(make).toHaveBeenCalledTimes(1)
    tileOff()
    expect(fullscreen()).toBe(first)
    fullOff()
    anotherOff()
  })
})
