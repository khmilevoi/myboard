// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ReactNode } from 'react'

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
    expect(screen.getByText('гасит долг · осталось 2 дня')).toBeInTheDocument()
  })

  it('state B — a closed day shows the plaque and no secondary actions', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-16',
        person: 'Карина',
        isDebtDay: true,
        status: 'closed',
        canUndo: true,
        debtRemaining: 1,
      },
    })
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByText('Уборка подтверждена')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Откатить' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'В долг' })).not.toBeInTheDocument()
  })

  it('state C — no debt shows the flat-balance subtitle', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-16',
        person: 'Леша',
        isDebtDay: false,
        status: 'pending',
        canUndo: false,
        debtRemaining: 0,
      },
      balance: [
        { person: 'Леша', debt: 0, over: false },
        { person: 'Карина', debt: 0, over: false },
      ],
    })
    withOfelia(makeOfeliaValue({ view }), <StandardTier />)

    expect(screen.getByText('по очереди · долгов нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Простить' })).not.toBeInTheDocument()
  })
})