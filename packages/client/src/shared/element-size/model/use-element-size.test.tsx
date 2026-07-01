import { act, render } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ElementSize } from './element-size-observer'

const holder = vi.hoisted(() => ({
  listener: null as unknown as (size: ElementSize) => void,
  stop: vi.fn(),
}))

vi.mock('./element-size-observer', () => ({
  observeElementSize: vi.fn((_element: Element, listener: (size: ElementSize) => void) => {
    holder.listener = listener
    return holder.stop
  }),
}))

import { observeElementSize } from './element-size-observer'
import { useElementSize } from './use-element-size'

function Probe() {
  const { width, height, ref } = useElementSize()
  return <div ref={ref as never} data-testid="probe" data-width={width} data-height={height} />
}

beforeEach(() => {
  vi.mocked(observeElementSize).mockClear()
  holder.stop.mockClear()
})

describe('useElementSize', () => {
  it('measures the element synchronously on mount', () => {
    const rectSpy = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ width: 320, height: 280 } as DOMRect)

    const { getByTestId } = render(<Probe />)
    const node = getByTestId('probe')

    expect(node.dataset.width).toBe('320')
    expect(node.dataset.height).toBe('280')

    rectSpy.mockRestore()
  })

  it('subscribes via observeElementSize and updates on resize notifications', () => {
    const { getByTestId } = render(<Probe />)
    expect(observeElementSize).toHaveBeenCalledTimes(1)

    act(() => holder.listener({ width: 480, height: 420 }))

    const node = getByTestId('probe')
    expect(node.dataset.width).toBe('480')
    expect(node.dataset.height).toBe('420')
  })

  it('unsubscribes when the element unmounts', () => {
    const { unmount } = render(<Probe />)
    expect(holder.stop).not.toHaveBeenCalled()

    unmount()

    expect(holder.stop).toHaveBeenCalledTimes(1)
  })
})
