// @vitest-environment jsdom
import { computed } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { LitterCardChoice, LitterOption } from '../model/card-choice'
import { LitterSwitcher } from './LitterSwitcher'

const OFELIA: LitterOption = {
  id: 'ofelia',
  title: 'Лоток · Офелия',
  catIds: ['ofelia'],
  cats: [{ id: 'ofelia', name: 'Офелия', avatar: null, litterId: 'ofelia', tone: 'a' }],
}
const BUSYA: LitterOption = {
  id: 'busya',
  title: 'Лоток · Буся',
  catIds: ['busya'],
  cats: [{ id: 'busya', name: 'Буся', avatar: null, litterId: 'busya', tone: 'b' }],
}

function choiceOf(options: LitterOption[] | null, choose = vi.fn(async () => {})) {
  const choice: LitterCardChoice = {
    options: computed(() => options),
    current: computed(() => options?.[0] ?? null),
    canSwitch: computed(() => (options?.length ?? 0) > 1),
    choose,
    litter: computed(() => null),
  }
  return { choice, choose }
}

describe('LitterSwitcher', () => {
  it('draws nothing while the choice is loading', () => {
    const { container } = render(
      <LitterSwitcher choice={choiceOf(null).choice} manage={{ kind: 'hint' }} variant="menu" />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('draws a lone litter as its avatar: no button', () => {
    render(
      <LitterSwitcher
        choice={choiceOf([OFELIA]).choice}
        manage={{ kind: 'hint' }}
        variant="menu"
      />,
    )
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('labels the litters by their titles and chooses through the card choice', async () => {
    const { choice, choose } = choiceOf([OFELIA, BUSYA])
    render(<LitterSwitcher choice={choice} manage={{ kind: 'hint' }} variant="menu" />)

    fireEvent.pointerDown(
      screen.getByRole('button', { name: 'Выбрать лоток · сейчас Лоток · Офелия' }),
      { button: 0, ctrlKey: false },
    )
    const menu = await screen.findByRole('menu', { name: 'Лотки' })
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Лоток · Буся' }))

    expect(choose).toHaveBeenCalledWith('busya')
  })
})
