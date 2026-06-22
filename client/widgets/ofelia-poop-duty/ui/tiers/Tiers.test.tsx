// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue } from '../ofelia.fixture'

import { CompactTier } from './CompactTier'
import { TinyTier } from './TinyTier'

function withOfelia(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('TinyTier', () => {
  it('shows the current person and no controls', () => {
    withOfelia(makeOfeliaValue(), <TinyTier />)
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('CompactTier', () => {
  it('renders the label, the icon actions, and the user toggle', () => {
    withOfelia(makeOfeliaValue(), <CompactTier />)
    expect(screen.getByText('Сегодня убирает')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подтвердить уборку' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Леша/ })).toBeInTheDocument()
  })

  it('confirms the day through context', () => {
    const onConfirm = vi.fn()
    const value = makeOfeliaValue()
    value.actions.onConfirm = onConfirm
    withOfelia(value, <CompactTier />)

    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить уборку' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('switches the current user through the toggle', () => {
    const onSetUser = vi.fn()
    const value = makeOfeliaValue()
    value.actions.onSetUser = onSetUser
    withOfelia(value, <CompactTier />)

    fireEvent.click(screen.getByRole('button', { name: /Леша/ }))
    expect(onSetUser).toHaveBeenCalledWith('Леша')
  })
})