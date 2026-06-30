import { describe, expect, it, vi } from 'vitest'

import { defineWidgetClient, toWidgetType } from './widget-definition'

describe('widget client definition', () => {
  it('caches a successful component load', async () => {
    const component = () => null
    const loader = vi.fn(async () => ({ default: component }))
    const type = toWidgetType(
      defineWidgetClient({
        id: 'probe',
        title: 'Probe',
        description: 'Probe widget',
        icon: 'Clock',
        defaultSize: { w: 1, h: 1 },
        loadComponent: loader,
      }),
    )

    await type.loadComponent()
    await type.loadComponent()

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('allows retry after a rejected component load', async () => {
    const component = () => null
    const loader = vi
      .fn<() => Promise<{ default: typeof component }>>()
      .mockRejectedValueOnce(new Error('chunk failed'))
      .mockResolvedValueOnce({ default: component })
    const type = toWidgetType(
      defineWidgetClient({
        id: 'probe',
        title: 'Probe',
        description: 'Probe widget',
        icon: 'Clock',
        defaultSize: { w: 1, h: 1 },
        loadComponent: loader,
      }),
    )

    await expect(type.loadComponent()).rejects.toThrow('chunk failed')
    await expect(type.loadComponent()).resolves.toEqual({ default: component })
    expect(loader).toHaveBeenCalledTimes(2)
  })
})
