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
  it('renders an entry with name, action label, and IP tail', () => {
    render(<HistoryList entries={[entry()]} />)

    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.getByText('убрал(а)')).toBeInTheDocument()
    expect(screen.getByText('2026-06-16')).toBeInTheDocument()
    expect(screen.getByText('0.0.22')).toBeInTheDocument()
  })

  it('renders an "за X" badge only when onBehalfOf is present', () => {
    const { rerender } = render(<HistoryList entries={[entry({ onBehalfOf: 'Леша' })]} />)
    expect(screen.getByText('за Леша')).toBeInTheDocument()

    rerender(<HistoryList entries={[entry()]} />)
    expect(screen.queryByText(/^за /)).not.toBeInTheDocument()
  })

  it('renders an empty state when there are no entries', () => {
    render(<HistoryList entries={[]} />)
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
  })
})
