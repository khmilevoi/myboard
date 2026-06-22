// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WeekDayView } from '../view-model'

import { WeekStrip } from './WeekStrip'

function days(): WeekDayView[] {
  return [
    { iso: '2026-06-15', weekday: 'ПН', dayOfMonth: 15, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-16', weekday: 'ВТ', dayOfMonth: 16, person: 'Карина', isToday: true, isDebtDay: false, isSelected: true },
    { iso: '2026-06-17', weekday: 'СР', dayOfMonth: 17, person: 'Карина', isToday: false, isDebtDay: true, isSelected: false },
    { iso: '2026-06-18', weekday: 'ЧТ', dayOfMonth: 18, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-19', weekday: 'ПТ', dayOfMonth: 19, person: 'Карина', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-20', weekday: 'СБ', dayOfMonth: 20, person: 'Леша', isToday: false, isDebtDay: false, isSelected: false },
    { iso: '2026-06-21', weekday: 'ВС', dayOfMonth: 21, person: 'Карина', isToday: false, isDebtDay: false, isSelected: false },
  ]
}

describe('WeekStrip', () => {
  it('renders a cell for every weekday', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    for (const label of ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
  })

  it('marks the selected and today cells', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    const tuesday = screen.getByTestId('week-day-2026-06-16')
    expect(tuesday).toHaveAttribute('data-selected', 'true')
    expect(tuesday).toHaveAttribute('data-today', 'true')
  })

  it('flags debt days', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    expect(screen.getByTestId('week-day-2026-06-17')).toHaveAttribute('data-debt', 'true')
  })

  it('calls onSelectDay with the clicked iso date', () => {
    const onSelectDay = vi.fn()
    render(<WeekStrip days={days()} onSelectDay={onSelectDay} />)
    fireEvent.click(screen.getByTestId('week-day-2026-06-19'))
    expect(onSelectDay).toHaveBeenCalledWith('2026-06-19')
  })
})
