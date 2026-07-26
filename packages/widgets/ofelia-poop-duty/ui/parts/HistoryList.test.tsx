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

/**
 * What a screen reader is left with: the rendered text minus everything hidden
 * from the accessibility tree. Asserting this rather than the DOM is the point —
 * the duty circles are `aria-hidden`, so a check against visible markup would
 * pass even with no announced subject at all.
 */
const announced = (element: HTMLElement): string => {
  const clone = element.cloneNode(true) as HTMLElement
  for (const hidden of clone.querySelectorAll('[aria-hidden="true"]')) hidden.remove()
  return (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
}

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

  it('renders a debt repayment as a negative pill', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ debtDelta: { person: 'Леша', amount: -1 } }) })]}
        today="2026-06-16"
      />,
    )
    expect(screen.getByText('−1 день')).toBeInTheDocument()
  })

  it('tags a record signed before accounts existed', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ recordedBy: { kind: 'person', person: 'Леша' } }) })]}
        today="2026-06-16"
      />,
    )
    expect(screen.getByText('отметил(а) Леша')).toBeInTheDocument()
    expect(screen.getByText('без аккаунта')).toBeInTheDocument()
  })

  it('names no author when the record carries none', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ recordedBy: { kind: 'unknown' } }) })]}
        today="2026-06-16"
      />,
    )
    expect(screen.getByText('автор неизвестен')).toBeInTheDocument()
  })

  it('phrases a system record as an automatic closure', () => {
    render(
      <HistoryList
        groups={[group({ current: view({ recordedBy: { kind: 'system' } }) })]}
        today="2026-06-16"
      />,
    )

    expect(screen.getByText('закрыто автоматически')).toBeInTheDocument()
  })

  it('renders an empty state', () => {
    render(<HistoryList groups={[]} today="2026-06-16" />)
    expect(screen.getByText('Пока нет событий')).toBeInTheDocument()
  })

  describe('accessible text', () => {
    it('announces the subject of the phrase, not just the verb', () => {
      const { container } = render(<HistoryList groups={[group()]} today="2026-06-16" />)
      expect(announced(container)).toContain('Леша убрал(а)')
    })

    it('announces both people of a debt day and whose day the pill moves', () => {
      const { container } = render(
        <HistoryList
          groups={[
            group({
              current: view({
                type: 'went_into_debt',
                onBehalfOf: 'Карина',
                debtDelta: { person: 'Карина', amount: 1 },
              }),
            }),
          ]}
          today="2026-06-16"
        />,
      )

      const text = announced(container)
      expect(text).toContain('Карина ушёл(ла) в долг → убирает Леша')
      expect(text).toContain('Карина: +1 день')
    })

    it('announces a reopened day without naming anyone', () => {
      const { container } = render(
        <HistoryList groups={[group({ current: view({ type: 'reset' }) })]} today="2026-06-16" />,
      )

      const text = announced(container)
      expect(text).toContain('день переоткрыт')
      expect(text).not.toContain('Леша')
    })
  })
})
