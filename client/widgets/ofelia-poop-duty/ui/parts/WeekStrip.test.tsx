// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { WeekDayView } from '../view-model'
import { WeekStrip } from './WeekStrip'

function days(): WeekDayView[] {
  return [
    {
      iso: '2026-06-15',
      weekday: 'ПН',
      dayOfMonth: 15,
      person: 'Леша',
      debtOwner: null,
      isToday: false,
      isDebtDay: false,
      isClosed: false,
      isSelected: false,
    },
    {
      iso: '2026-06-16',
      weekday: 'ВТ',
      dayOfMonth: 16,
      person: 'Карина',
      debtOwner: null,
      isToday: true,
      isDebtDay: false,
      isClosed: true,
      isSelected: true,
    },
    {
      iso: '2026-06-17',
      weekday: 'СР',
      dayOfMonth: 17,
      person: 'Карина',
      debtOwner: 'Леша',
      isToday: false,
      isDebtDay: true,
      isClosed: true,
      isSelected: false,
    },
    {
      iso: '2026-06-18',
      weekday: 'ЧТ',
      dayOfMonth: 18,
      person: 'Леша',
      debtOwner: null,
      isToday: false,
      isDebtDay: false,
      isClosed: false,
      isSelected: false,
    },
    {
      iso: '2026-06-19',
      weekday: 'ПТ',
      dayOfMonth: 19,
      person: 'Карина',
      debtOwner: null,
      isToday: false,
      isDebtDay: false,
      isClosed: false,
      isSelected: false,
    },
    {
      iso: '2026-06-20',
      weekday: 'СБ',
      dayOfMonth: 20,
      person: 'Леша',
      debtOwner: null,
      isToday: false,
      isDebtDay: false,
      isClosed: false,
      isSelected: false,
    },
    {
      iso: '2026-06-21',
      weekday: 'ВС',
      dayOfMonth: 21,
      person: 'Карина',
      debtOwner: null,
      isToday: false,
      isDebtDay: false,
      isClosed: false,
      isSelected: false,
    },
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
    expect(tuesday.querySelector('[data-testid="week-day-today-dot"]')).toBeInTheDocument()
  })

  it('flags debt days', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    const day = screen.getByTestId('week-day-2026-06-17')
    expect(day).toHaveAttribute('data-debt', 'true')
    expect(day.querySelector('[data-testid="week-day-today-dot"]')).not.toBeInTheDocument()
  })

  it('marks closed days with a check', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    const day = screen.getByTestId('week-day-2026-06-16')
    expect(day).toHaveAttribute('data-closed', 'true')
    expect(day.querySelector('[data-testid="week-day-closed-icon"]')).toBeInTheDocument()
    expect(day).not.toHaveTextContent('✓')
  })

  it('renders debt ownership as a small badge over the final actor avatar', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    const day = screen.getByTestId('week-day-2026-06-17')
    expect(day.querySelector('[data-testid="week-day-small-badge"]')).toHaveTextContent('Л')
    expect(day.querySelector('[data-tone="k"]')).not.toBeNull()
  })

  it('describes the dot as the current-day marker', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    expect(screen.getByText('текущий день')).toBeInTheDocument()
    expect(screen.queryByText('дни гашения долга')).not.toBeInTheDocument()
  })

  it('renders avatars at 26px', () => {
    render(<WeekStrip days={days()} onSelectDay={vi.fn()} />)
    const day = screen.getByTestId('week-day-2026-06-15')
    const avatar = day.querySelector('[data-tone="l"]')
    expect(avatar).not.toBeNull()
    expect(avatar).toHaveStyle({ width: '26px', height: '26px' })
  })

  it('calls onSelectDay with the clicked iso date', () => {
    const onSelectDay = vi.fn()
    render(<WeekStrip days={days()} onSelectDay={onSelectDay} />)
    fireEvent.click(screen.getByTestId('week-day-2026-06-19'))
    expect(onSelectDay).toHaveBeenCalledWith('2026-06-19')
  })
})
