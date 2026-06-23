// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { HistoryEntryView } from 'widgets/ofelia-poop-duty/model/ofelia-duty'

import { HistoryList } from './HistoryList'

const entry = (overrides: Partial<HistoryEntryView> = {}): HistoryEntryView => ({
  id: 'e1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Карина',
  by: 'Карина',
  ipTail: '0.0.22',
  ...overrides,
})

describe('HistoryList', () => {
  it('renders vertical layout with date and avatar+name row', () => {
    render(<HistoryList entries={[entry()]} />)
    expect(screen.getByText('2026-06-16')).toBeInTheDocument()
    expect(screen.getByText('Карина')).toBeInTheDocument()
  })

  it('renders "долг" badge for went_into_debt', () => {
    render(<HistoryList entries={[entry({ type: 'went_into_debt' })]} />)
    expect(screen.getByText('долг')).toBeInTheDocument()
  })

  it('renders "за {initial}" badge for cleaned with onBehalfOf', () => {
    render(<HistoryList entries={[entry({ onBehalfOf: 'Леша' })]} />)
    expect(screen.getByText('за Л')).toBeInTheDocument()
  })

  it('renders "−1 день" badge for forgiven', () => {
    render(<HistoryList entries={[entry({ type: 'forgiven' })]} />)
    expect(screen.getByText('−1 день')).toBeInTheDocument()
  })

  it('renders no badge for cleaned without onBehalfOf', () => {
    render(<HistoryList entries={[entry()]} />)
    expect(screen.queryByText(/^за /)).not.toBeInTheDocument()
    expect(screen.queryByText('долг')).not.toBeInTheDocument()
  })

  it('renders an empty state when there are no entries', () => {
    render(<HistoryList entries={[]} />)
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
  })
})