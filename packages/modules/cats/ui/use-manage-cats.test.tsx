import { atom, context } from '@reatom/core'
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  WidgetRuntimeContext,
  type WidgetBoardAccess,
  type WidgetRuntimeProps,
} from 'widget-runtime'

import { CATS_WIDGET_ID, useManageCats } from './use-manage-cats'

// Unmount first: a component unmounting after the reset touches a dead root.
afterEach(() => {
  cleanup()
  context.reset()
})

function wrapperWith(board: WidgetBoardAccess | undefined) {
  const props = { instanceId: 'w1', typeId: 'ofelia-poop-duty', board } as WidgetRuntimeProps
  return ({ children }: { children: ReactNode }) => (
    <WidgetRuntimeContext.Provider value={props}>{children}</WidgetRuntimeContext.Provider>
  )
}

describe('useManageCats', () => {
  it("names the cats widget's id", () => {
    expect(CATS_WIDGET_ID).toBe('cats')
  })

  it('returns the hint when the host offers no board access', () => {
    const { result } = renderHook(() => useManageCats(), { wrapper: wrapperWith(undefined) })
    expect(result.current).toEqual({ kind: 'hint' })
  })

  it('returns the hint when no cats card is placed', () => {
    const none = atom<string | null>(null, 'test.noCats')
    const board: WidgetBoardAccess = {
      firstInstanceOf: () => none,
      expand: vi.fn(),
    }
    const { result } = renderHook(() => useManageCats(), { wrapper: wrapperWith(board) })
    expect(result.current).toEqual({ kind: 'hint' })
  })

  it('opens the first placed cats card', () => {
    const expand = vi.fn()
    const placed = atom<string | null>('2', 'test.cats')
    const firstInstanceOf = vi.fn(() => placed)
    const { result } = renderHook(() => useManageCats(), {
      wrapper: wrapperWith({ firstInstanceOf, expand }),
    })

    expect(firstInstanceOf).toHaveBeenCalledWith('cats')
    const manage = result.current
    expect(manage.kind).toBe('open')
    if (manage.kind !== 'open') return
    act(() => manage.onOpen())
    expect(expand).toHaveBeenCalledWith('2')
  })
})
