import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { CatSummary } from '../model/cats-model'
import { CatSwitcher, type CatSwitcherManage, type CatSwitcherProps } from './CatSwitcher'

const OFELIA: CatSummary = {
  id: 'ofelia',
  name: 'Офелия',
  avatar: null,
  litterId: 'ofelia',
  tone: 'a',
}
const BUSYA: CatSummary = { id: 'busya', name: 'Буся', avatar: null, litterId: 'busya', tone: 'b' }

const ONE_CAT = [{ id: 'ofelia', label: 'Офелия', cats: [OFELIA] }]
const TWO_CATS = [...ONE_CAT, { id: 'busya', label: 'Буся', cats: [BUSYA] }]
const HINT: CatSwitcherManage = { kind: 'hint' }

const HINT_TEXT =
  'Добавить или изменить кошку — в виджете «Кошки». Поставьте его на борду из каталога.'

function renderSwitcher(props: Partial<CatSwitcherProps> = {}) {
  const onChoose = vi.fn()
  const view = render(
    <CatSwitcher
      kind="cat"
      options={TWO_CATS}
      currentId="ofelia"
      onChoose={onChoose}
      variant="menu"
      manage={HINT}
      {...props}
    />,
  )
  return { ...view, onChoose }
}

// Radix's DropdownMenuTrigger opens on pointerdown, not on click.
async function openMenu(name: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name }), { button: 0, ctrlKey: false })
  return screen.findByRole('menu')
}

describe('CatSwitcher', () => {
  it('draws one option as the avatar alone: no button, no chevron', () => {
    const { container } = renderSwitcher({ options: ONE_CAT })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.querySelector('svg')).toBeNull()
    expect(container).toHaveTextContent('О')
  })

  it('sizes a lone cat for the card header and a lone litter for the litter header', () => {
    const cat = renderSwitcher({ options: ONE_CAT })
    expect(cat.container.querySelector('[data-tone]')).toHaveAttribute('data-size', 'header')
    cat.unmount()

    const litter = renderSwitcher({
      kind: 'litter',
      options: [{ id: 'ofelia', label: 'Лоток · Офелия', cats: [OFELIA] }],
    })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(litter.container.querySelector('[data-tone]')).toHaveAttribute('data-size', 'menu')
  })

  it('opens a menu of the options from the button', async () => {
    renderSwitcher()
    const button = screen.getByRole('button', { name: 'Выбрать кошку · сейчас Офелия' })
    expect(button).toHaveAttribute('aria-haspopup', 'menu')

    const menu = await openMenu('Выбрать кошку · сейчас Офелия')
    expect(menu).toHaveAccessibleName('Кошки')
    expect(screen.getByRole('menuitemradio', { name: 'Офелия' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
    expect(screen.getByRole('menuitemradio', { name: 'Буся' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
  })

  it('chooses an option', async () => {
    const { onChoose } = renderSwitcher()
    await openMenu('Выбрать кошку · сейчас Офелия')

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Буся' }))

    expect(onChoose).toHaveBeenCalledWith('busya')
  })

  it('offers "Управлять кошками →" when a cats card is placed', async () => {
    const onOpen = vi.fn()
    renderSwitcher({ manage: { kind: 'open', onOpen } })
    await openMenu('Выбрать кошку · сейчас Офелия')

    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Управлять кошками →' }))

    expect(onOpen).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
  })

  it('explains where to manage cats when no cats card is placed', async () => {
    renderSwitcher({ manage: HINT })
    await openMenu('Выбрать кошку · сейчас Офелия')

    expect(screen.getByText(HINT_TEXT)).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Управлять кошками →' })).not.toBeInTheDocument()
  })

  it('draws nothing in the badge variant with one option', () => {
    const { container } = renderSwitcher({ variant: 'badge', options: ONE_CAT })
    expect(container).toBeEmptyDOMElement()
  })

  it('draws a non-interactive badge titled with the current option with several', () => {
    const { container } = renderSwitcher({ variant: 'badge', currentId: 'busya' })
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(container.firstElementChild).toHaveAttribute('title', 'Буся')
    expect(container).toHaveTextContent('Б')
  })

  it('names the litter variant after the litter', async () => {
    renderSwitcher({
      kind: 'litter',
      currentId: 'busya',
      options: [
        { id: 'ofelia', label: 'Лоток · Офелия', cats: [OFELIA] },
        { id: 'busya', label: 'Лоток · Буся', cats: [BUSYA] },
      ],
    })

    const menu = await openMenu('Выбрать лоток · сейчас Лоток · Буся')
    expect(menu).toHaveAccessibleName('Лотки')
  })

  it('stacks the avatars of a shared litter', () => {
    const { container } = renderSwitcher({
      kind: 'litter',
      options: [{ id: 'ofelia', label: 'Лоток · Офелия и Буся', cats: [OFELIA, BUSYA] }],
    })
    expect([...container.querySelectorAll('[data-tone]')].map((node) => node.textContent)).toEqual([
      'О',
      'Б',
    ])
  })
})
