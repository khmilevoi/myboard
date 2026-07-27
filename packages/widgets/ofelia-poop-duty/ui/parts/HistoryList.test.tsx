// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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

    // F17: the signature row's MemberAvatar (account kind) used to carry its
    // initial to assistive tech, so this read "Котметил(а) Карина…" — the
    // name announced once for the avatar and again for the written text.
    // `toContain('отметил(а) Карина')` would not catch that (the substring
    // is still present); assert the accessible text STARTS with the written
    // signature instead, with nothing announced ahead of it.
    it('does not repeat the account initial before its written name in the signature (F17)', () => {
      render(<HistoryList groups={[group()]} today="2026-06-16" />)

      const signature = screen.getByText('отметил(а) Карина').parentElement as HTMLElement
      expect(announced(signature).startsWith('отметил(а) Карина')).toBe(true)
    })
  })

  describe('scroll-to-day (F13)', () => {
    // jsdom never actually lays anything out, so every layout metric below
    // is 0 by default — each scenario mocks exactly the box(es) it needs.
    const stubOverflow = (
      el: HTMLElement,
      { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number },
    ) => {
      el.style.overflowY = 'auto'
      Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
      Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
      el.scrollTo = vi.fn()
    }

    const stubRectTop = (el: HTMLElement, top: number) => {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top } as DOMRect)
    }

    // A day rendered before its group exists in the DOM has no layout box,
    // so mount it selected on day one and move to day two once mounted —
    // the effect's own first-run guard only records the mounted selection.
    const twoGroups = [
      group({ dutyDate: '2026-06-15', current: view({ dutyDate: '2026-06-15' }) }),
      group({ dutyDate: '2026-06-16' }),
    ]

    it('does not escape to an outer overflowing box when the nearest scrollable ancestor has nothing to scroll yet', () => {
      const { container, rerender } = render(
        <div data-testid="body">
          <div data-testid="historyCol">
            <HistoryList groups={twoGroups} today="2026-06-16" selectedDate="2026-06-15" />
          </div>
        </div>,
      )
      const body = screen.getByTestId('body')
      const historyCol = screen.getByTestId('historyCol')
      // `.body` overflows; `.historyCol` (the intended target, nearer to the
      // group) does not — before the fix the walk escaped past it to `.body`.
      stubOverflow(body, { scrollHeight: 800, clientHeight: 400 })
      stubOverflow(historyCol, { scrollHeight: 200, clientHeight: 400 })
      Object.defineProperty(
        container.querySelector('[data-duty-date="2026-06-16"]') as HTMLElement,
        'offsetParent',
        { value: document.body, configurable: true },
      )

      rerender(
        <div data-testid="body">
          <div data-testid="historyCol">
            <HistoryList groups={twoGroups} today="2026-06-16" selectedDate="2026-06-16" />
          </div>
        </div>,
      )

      expect(historyCol.scrollTo).not.toHaveBeenCalled()
      expect(body.scrollTo).not.toHaveBeenCalled()
    })

    it('scrolls the nearest scrollable ancestor, not an outer one, when it actually overflows', () => {
      const { container, rerender } = render(
        <div data-testid="body">
          <div data-testid="historyCol">
            <HistoryList groups={twoGroups} today="2026-06-16" selectedDate="2026-06-15" />
          </div>
        </div>,
      )
      const body = screen.getByTestId('body')
      const historyCol = screen.getByTestId('historyCol')
      stubOverflow(body, { scrollHeight: 800, clientHeight: 400 })
      stubOverflow(historyCol, { scrollHeight: 800, clientHeight: 400 })
      stubRectTop(historyCol, 100)
      const targetGroup = container.querySelector('[data-duty-date="2026-06-16"]') as HTMLElement
      Object.defineProperty(targetGroup, 'offsetParent', {
        value: document.body,
        configurable: true,
      })
      stubRectTop(targetGroup, 500)

      rerender(
        <div data-testid="body">
          <div data-testid="historyCol">
            <HistoryList groups={twoGroups} today="2026-06-16" selectedDate="2026-06-16" />
          </div>
        </div>,
      )

      expect(historyCol.scrollTo).toHaveBeenCalledWith({
        top: 400,
        behavior: 'smooth',
      })
      expect(body.scrollTo).not.toHaveBeenCalled()
    })

    it('does not scroll a day whose group has no layout box, e.g. a hidden mobile tab', () => {
      const { container, rerender } = render(
        <div data-testid="body">
          <div data-testid="historyCol">
            <HistoryList groups={twoGroups} today="2026-06-16" selectedDate="2026-06-15" />
          </div>
        </div>,
      )
      const body = screen.getByTestId('body')
      const historyCol = screen.getByTestId('historyCol')
      stubOverflow(body, { scrollHeight: 800, clientHeight: 400 })
      stubOverflow(historyCol, { scrollHeight: 800, clientHeight: 400 })
      stubRectTop(historyCol, 100)
      const targetGroup = container.querySelector('[data-duty-date="2026-06-16"]') as HTMLElement
      stubRectTop(targetGroup, 500)
      // `offsetParent` is left at jsdom's default `null` — a hidden mobile
      // tab (`display: none`) never has one either.

      rerender(
        <div data-testid="body">
          <div data-testid="historyCol">
            <HistoryList groups={twoGroups} today="2026-06-16" selectedDate="2026-06-16" />
          </div>
        </div>,
      )

      expect(historyCol.scrollTo).not.toHaveBeenCalled()
      expect(body.scrollTo).not.toHaveBeenCalled()
    })
  })
})
