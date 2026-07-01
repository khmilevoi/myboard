// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue, makeOfeliaView } from '../ofelia.fixture'
import { StandardTier } from './StandardTier'

function withOfelia(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('StandardTier', () => {
  it('state A — open debt day shows the confirm button and the debt subtitle', () => {
    withOfelia(makeOfeliaValue(), <StandardTier />)
    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
    expect(screen.getByText('гасит долг · 2 дня')).toBeInTheDocument()
  })

  it('does not render UserToggle', () => {
    withOfelia(makeOfeliaValue(), <StandardTier />)
    expect(screen.queryByText('Я:')).not.toBeInTheDocument()
  })

  it('shows hint text with other person name', () => {
    withOfelia(makeOfeliaValue(), <StandardTier />)
    // Default fixture has Карина as selected person → other is Леша
    expect(screen.getByText(/Не успеваешь\? Уберёт Леша/)).toBeInTheDocument()
  })

  it('state B — closed day shows plaque, undo, and disabled secondary', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-16',
        person: 'Карина',
        isDebtDay: true,
        status: 'closed',
        canUndo: true,
        debtRemaining: 1,
        isFuture: false,
      },
    })
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Откатить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
  })

  it('state C — no debt shows Простить disabled', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-16',
        person: 'Леша',
        isDebtDay: false,
        status: 'pending',
        canUndo: false,
        debtRemaining: 0,
        isFuture: false,
      },
      balance: [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 0, over: false },
      ],
    })
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByText('по очереди · долгов нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Простить' })).toBeDisabled()
  })

  it('state D — future day shows disabled buttons instead of hiding them', () => {
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
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'В долг' })).toBeDisabled()
  })

  it('draws its expand/delete controls when wired', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    withOfelia(makeOfeliaValue(), <StandardTier onExpand={onExpand} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})
