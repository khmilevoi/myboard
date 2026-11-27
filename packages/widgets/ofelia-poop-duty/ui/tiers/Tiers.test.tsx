// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ofeliaContext } from '../ofelia-context'
import type { OfeliaContextValue } from '../ofelia-context'
import {
  BUSYA_LITTER,
  OFELIA_LITTER,
  makeOfeliaCard,
  makeOfeliaValue,
  makeOfeliaView,
} from '../ofelia.fixture'
import { CompactTier } from './CompactTier'
import { StandardTier } from './StandardTier'
import { TinyTier } from './TinyTier'

function withOfelia(value: OfeliaContextValue, node: ReactNode) {
  return render(<ofeliaContext.Provider value={value}>{node}</ofeliaContext.Provider>)
}

describe('TinyTier', () => {
  it('shows the current person and no controls by default', () => {
    withOfelia(makeOfeliaValue(), <TinyTier chrome={{}} />)
    expect(screen.getByText('Карина')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('draws its expand/delete controls when wired', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    withOfelia(makeOfeliaValue(), <TinyTier chrome={{ onExpand, onDelete }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('CompactTier', () => {
  it('renders the compact card actions', () => {
    withOfelia(makeOfeliaValue(), <CompactTier chrome={{}} />)
    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Отложить' })).toBeInTheDocument()
  })

  it('confirms the day through context', () => {
    const onConfirm = vi.fn()
    const value = makeOfeliaValue()
    value.actions.onConfirm = onConfirm
    withOfelia(value, <CompactTier chrome={{}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Какашки убраны' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('draws its expand/delete controls when wired', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    withOfelia(makeOfeliaValue(), <CompactTier chrome={{ onExpand, onDelete }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
  })

  it('hides the action controls for a future day', () => {
    const view = makeOfeliaView({
      selected: {
        iso: '2026-06-18',
        person: 'Леша',
        isDebtDay: false,
        status: 'pending',
        canUndo: false,
        debtRemaining: 0,
        isFuture: true,
      },
    })
    withOfelia(makeOfeliaValue({ view }), <CompactTier chrome={{}} />)

    expect(screen.queryByRole('button', { name: 'Подтвердить уборку' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Отложить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Простить' })).not.toBeInTheDocument()
  })

  // F6a: a failed day action used to fail floating, with nothing disabling
  // the buttons and nothing showing the error.
  it('disables the actions while pending and shows the last action error', () => {
    const view = makeOfeliaView({
      actionPending: true,
      actionErrorMessage: 'Нет соединения с сервером',
    })
    withOfelia(makeOfeliaValue({ view }), <CompactTier chrome={{}} />)

    expect(screen.getByRole('button', { name: 'Какашки убраны' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Нет соединения с сервером')
  })
})

const TWO = [OFELIA_LITTER, BUSYA_LITTER]

describe('litter header', () => {
  it('compact — a shared litter drops the icon so its long title has room (page 05, B)', () => {
    const shared = {
      ...OFELIA_LITTER,
      title: 'Лоток · Офелия и Буся',
      catIds: ['ofelia', 'busya'],
      cats: [...OFELIA_LITTER.cats, ...BUSYA_LITTER.cats],
    }
    const view = withOfelia(
      makeOfeliaValue({ card: makeOfeliaCard({ options: [shared] }) }),
      <CompactTier chrome={{}} />,
    )
    expect(
      screen.getByRole('heading', { name: 'Лоток · Офелия и Буся' }).previousElementSibling,
    ).toBeNull()
    view.unmount()

    withOfelia(makeOfeliaValue(), <CompactTier chrome={{}} />)
    expect(
      screen.getByRole('heading', { name: 'Лоток · Офелия' }).previousElementSibling,
    ).not.toBeNull()
  })

  it('tiny — no header row; a corner badge only with more than one litter', () => {
    const one = withOfelia(makeOfeliaValue(), <TinyTier chrome={{}} />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(one.container.querySelector('[title]')).toBeNull()
    one.unmount()

    const two = withOfelia(
      makeOfeliaValue({ card: makeOfeliaCard({ options: TWO }) }),
      <TinyTier chrome={{}} />,
    )
    expect(two.container.querySelector('[title="Лоток · Офелия"]')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('compact — one litter: the title, no switcher button', () => {
    withOfelia(makeOfeliaValue(), <CompactTier chrome={{}} />)
    expect(screen.getByRole('heading', { name: 'Лоток · Офелия' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Выбрать лоток/ })).not.toBeInTheDocument()
  })

  it('compact — two litters: the switcher chooses through the card choice', async () => {
    const choose = vi.fn(async () => {})
    withOfelia(
      makeOfeliaValue({ card: makeOfeliaCard({ options: TWO, choose }) }),
      <CompactTier chrome={{}} />,
    )
    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Офелия' }),
      { button: 0, ctrlKey: false },
    )
    const menu = await screen.findByRole('menu', { name: 'Лотки' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Лоток · Буся' }))
    expect(choose).toHaveBeenCalledWith('busya')
  })

  it('standard — the title follows the chosen litter', () => {
    withOfelia(
      makeOfeliaValue({ card: makeOfeliaCard({ options: TWO, currentId: 'busya' }) }),
      <StandardTier chrome={{}} />,
    )
    expect(screen.getByRole('heading', { name: 'Лоток · Буся' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Буся' }),
    ).toBeInTheDocument()
  })
})
