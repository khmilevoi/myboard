// @vitest-environment jsdom
import { context, atom, wrap } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { reatomMemo } from './reatom-memo'

const counter = atom(0, 'test.counter')

beforeEach(() => {
  context.reset()
})

describe('reatomMemo', () => {
  it('wraps a reatom component and keeps atom reads reactive', async () => {
    const Counter = reatomMemo(
      () => <button onClick={wrap(() => counter.set((value) => value + 1))}>{counter()}</button>,
      {
        name: 'TestCounter',
      },
    )

    render(<Counter />)

    expect(screen.getByRole('button', { name: '0' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '1' })).toBeInTheDocument()
    })
  })

  it('memoizes the exported component for unchanged props', () => {
    const renderSpy = vi.fn()
    const Label = reatomMemo<{ label: string }>(({ label }) => {
      renderSpy(label)
      return <span>{label}</span>
    }, 'TestLabel')

    const { rerender } = render(<Label label="stable" />)
    rerender(<Label label="stable" />)

    expect(renderSpy).toHaveBeenCalledTimes(1)
  })
})
