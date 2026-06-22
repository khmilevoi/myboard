// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue } from '../ofelia.fixture'
import { RichLayout } from './RichLayout'

function renderRich(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('RichLayout', () => {
  it('renders the header, week range, calendar, and empty history/comments', () => {
    renderRich(makeOfeliaValue(), <RichLayout />)

    expect(screen.getByText('Лоток Офелии')).toBeInTheDocument()
    expect(screen.getByText('15–21 июня')).toBeInTheDocument()
    expect(screen.getByText('ПН')).toBeInTheDocument()
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
    expect(screen.getByText('Пока нет комментариев')).toBeInTheDocument()
  })

  it('wires week navigation and day selection from context', () => {
    const onPrevWeek = vi.fn()
    const onSelectDay = vi.fn()
    const value = makeOfeliaValue()
    value.nav.onPrevWeek = onPrevWeek
    value.actions.onSelectDay = onSelectDay

    renderRich(value, <RichLayout />)

    fireEvent.click(screen.getByRole('button', { name: 'Прошлая неделя' }))
    expect(onPrevWeek).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByTestId('week-day-2026-06-19'))
    expect(onSelectDay).toHaveBeenCalledWith('2026-06-19')
  })

  it('shows the close affordance only when onClose is provided', () => {
    const onClose = vi.fn()
    const { rerender } = renderRich(makeOfeliaValue(), <RichLayout onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <ofeliaContext.Provider value={makeOfeliaValue()}>
        <RichLayout />
      </ofeliaContext.Provider>,
    )
    expect(screen.queryByRole('button', { name: 'Закрыть' })).not.toBeInTheDocument()
  })
})
