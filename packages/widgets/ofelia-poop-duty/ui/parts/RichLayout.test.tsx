// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import { makeOfeliaValue, makeOfeliaView } from '../ofelia.fixture'
import { RichLayout } from './RichLayout'

import styles from './RichLayout.module.css'

function renderRich(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

function activateTab(name: 'История' | 'Комментарии') {
  fireEvent.mouseDown(screen.getByRole('tab', { name }))
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

  it('shows expand/delete affordances only when those callbacks are provided', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    renderRich(makeOfeliaValue(), <RichLayout onExpand={onExpand} onDelete={onDelete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('uses the rich action copy, real mobile tabs, and 62px main avatar', () => {
    const { container } = renderRich(makeOfeliaValue(), <RichLayout />)
    const split = container.querySelector('[data-tab]')
    const mobileTabs = container.querySelector(`.${styles.mobileTabsVisible}`)

    expect(screen.getAllByRole('button', { name: 'Подтвердить уборку' })).toHaveLength(2)
    expect(split).toHaveAttribute('data-tab', 'history')
    expect(mobileTabs).toBeInTheDocument()

    expect(screen.getByRole('tablist', { hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Комментарии' })).toHaveAttribute(
      'aria-selected',
      'false',
    )

    activateTab('Комментарии')

    expect(screen.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Комментарии' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(split).toHaveAttribute('data-tab', 'comments')

    const mainAvatar = container.querySelector('[style*="width: 62px"][style*="height: 62px"]')
    expect(mainAvatar).toBeInTheDocument()
    expect(mainAvatar).toHaveTextContent('К')
  })

  it('disables future-day action controls instead of hiding them', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-19',
        person: 'Карина',
        isDebtDay: false,
        status: 'pending',
        canUndo: false,
        debtRemaining: 0,
        isFuture: true,
      },
    })
    renderRich(makeOfeliaValue({ view }), <RichLayout />)

    for (const button of screen.getAllByRole('button', { name: 'Подтвердить уборку' })) {
      expect(button).toBeDisabled()
    }
    for (const button of screen.getAllByRole('button', { name: 'В долг' })) {
      expect(button).toBeDisabled()
    }
    for (const button of screen.getAllByRole('button', { name: 'Простить' })) {
      expect(button).toBeDisabled()
    }
  })

  it('keeps the parent-owned tab state bridge on the split container', () => {
    const { container } = renderRich(makeOfeliaValue(), <RichLayout />)
    const split = container.querySelector('[data-tab]')

    expect(split).toHaveAttribute('data-tab', 'history')

    activateTab('Комментарии')
    expect(split).toHaveAttribute('data-tab', 'comments')

    activateTab('История')
    expect(split).toHaveAttribute('data-tab', 'history')
  })
})
