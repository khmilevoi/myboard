// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue, makeOfeliaView } from '../ofelia.fixture'
import { CompactTier } from './CompactTier'
import { TinyTier } from './TinyTier'

function withOfelia(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('TinyTier', () => {
  it('shows the current person and no controls by default', () => {
    withOfelia(makeOfeliaValue(), <TinyTier />)
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws its expand/delete controls when wired', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    withOfelia(makeOfeliaValue(), <TinyTier onExpand={onExpand} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
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

  it('draws its expand/delete controls when wired', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    withOfelia(makeOfeliaValue(), <CompactTier onExpand={onExpand} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('hides the action controls for a future day', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-18',
        person: 'Леша',
        isDebtDay: false,
        status: 'pending',
        canUndo: false,
        debtRemaining: 0,
        isFuture: true,
      },
    })
    withOfelia(makeOfeliaValue({ view }), <CompactTier />)

    expect(screen.queryByRole('button', { name: 'Подтвердить уборку' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В долг' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Простить' })).not.toBeInTheDocument()
  })
})
