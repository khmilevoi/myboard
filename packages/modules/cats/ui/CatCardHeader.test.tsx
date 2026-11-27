// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CatCardHeader } from './CatCardHeader'

const labels = () =>
  screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'))

describe('CatCardHeader', () => {
  it('renders the icon, the title, the switcher, then the board-card controls', () => {
    const onExpand = vi.fn()
    const onDelete = vi.fn()
    render(
      <CatCardHeader
        icon={<svg data-testid="icon" />}
        title="Лоток · Офелия и Буся"
        switcher={
          <button type="button" aria-label="Выбрать лоток · сейчас Лоток · Офелия и Буся" />
        }
        chrome={{ onExpand, onDelete }}
      />,
    )

    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('Лоток · Офелия и Буся')).toBeInTheDocument()
    expect(labels()).toEqual([
      'Выбрать лоток · сейчас Лоток · Офелия и Буся',
      'Развернуть',
      'Удалить',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))
    expect(onDelete).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Развернуть' }))
    expect(onExpand).toHaveBeenCalledOnce()
  })

  it('places the controls inline', () => {
    const { container } = render(
      <CatCardHeader icon={null} title="Лоток" switcher={null} chrome={{ onDelete: vi.fn() }} />,
    )
    expect(container.querySelector('[data-placement]')).toHaveAttribute('data-placement', 'inline')
  })

  // A card that is still loading, failed, or empty hands over the chrome minus "Развернуть":
  // "Удалить" must still be there.
  it('renders delete alone when the chrome has only delete', () => {
    render(
      <CatCardHeader icon={null} title="Лоток" switcher={null} chrome={{ onDelete: vi.fn() }} />,
    )
    expect(labels()).toEqual(['Удалить'])
  })

  it('renders only close in the fullscreen mount', () => {
    render(
      <CatCardHeader icon={null} title="Лоток" switcher={null} chrome={{ onClose: vi.fn() }} />,
    )
    expect(labels()).toEqual(['Закрыть'])
  })
})
