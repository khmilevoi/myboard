// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { ofeliaContext } from '../ofelia-context'
import { makeOfeliaValue } from '../ofelia.fixture'

import { FullscreenTier } from './FullscreenTier'
import { LargeTier } from './LargeTier'

function withOfelia(node: ReactNode) {
  return render(<ofeliaContext.Provider value={makeOfeliaValue()}>{node}</ofeliaContext.Provider>)
}

describe('LargeTier', () => {
  it('renders the rich layout without a close button', () => {
    withOfelia(<LargeTier />)
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })
})

describe('FullscreenTier', () => {
  it('renders the rich layout with a wired close button', () => {
    const onClose = vi.fn()
    withOfelia(<FullscreenTier onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
