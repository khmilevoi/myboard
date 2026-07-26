// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { HistoryDayGroup, HistoryEntryView } from '@/model/history-view'

import { HistoryList } from './HistoryList'

const KARINA = { kind: 'account', accountId: 'a1', name: 'Карина' } as const

const view = (o: Partial<HistoryEntryView> = {}): HistoryEntryView => ({
  id: 'e1',
  type: 'cleaned',
  actor: 'Леша',
  dutyDate: '2026-06-16',
  recordedAt: Date.UTC(2026, 5, 16, 19, 40),
  recordedBy: KARINA,
  isViewerRecord: false,
  recordedLate: false,
  debtDelta: null,
  ...o,
})

const group = (o: Partial<HistoryDayGroup> = {}): HistoryDayGroup => ({
  dutyDate: '2026-06-16',
  current: view(),
  superseded: [],
  ...o,
})

describe('HistoryList', () => {
  it('renders the day header and the signature', () => {
    render(<HistoryList groups={[group()]} today="2026-06-16" />)

    expect(screen.getByText('сегодня')).toBeInTheDocument()
    expect(screen.getByText('вт')).toBeInTheDocument()
    expect(screen.getByText('отметил(а) Карина')).toBeInTheDocument()
    expect(screen.getByText('21:40')).toBeInTheDocument()
  })

  it('never renders an ip', () => {
    const { container } = render(<HistoryList groups={[group()]} today="2026-06-16" />)
    expect(container.textContent).not.toMatch(/\d+\.\d+\.\d+/)
  })

  it('renders the debt pill with its amount', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ debtDelta: { person: 'Карина', amount: 1 } }) })]}
        today="2026-06-16"
      />,
    )
    expect(screen.getByText('+1 день')).toBeInTheDocument()
  })

  it('marks superseded records and counts them in the header', () => {
    render(
      <HistoryList
        groups={[group({ superseded: [view({ id: 'old', type: 'reset' })] })]}
        today="2026-06-16"
      />,
    )

    expect(screen.getByText('2 записи')).toBeInTheDocument()
    const stale = screen.getByTestId('history-superseded-old')
    expect(within(stale).getByText('перекрыто')).toBeInTheDocument()
  })

  it('shows the recording date when it differs from the duty day', () => {
    render(
      <HistoryList
        groups={[
          group({
            current: view({ recordedLate: true, recordedAt: Date.UTC(2026, 5, 18, 19, 40) }),
          }),
        ]}
        today="2026-06-18"
      />,
    )
    expect(screen.getByText('18 июня')).toBeInTheDocument()
  })

  it('renders an empty state', () => {
    render(<HistoryList groups={[]} today="2026-06-16" />)
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
  })
})
