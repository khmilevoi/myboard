// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { instances } from '../model/board-model'
import { AddWidgetMenu } from './AddWidgetMenu'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('AddWidgetMenu', () => {
  it('adds a widget when a catalog item is clicked', async () => {
    render(<AddWidgetMenu />)
    const trigger = screen.getByRole('button', { name: /add widget/i })
    expect(instances()).toHaveLength(0)
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /clock/i }))
    expect(instances()).toHaveLength(1)
    expect(instances()[0]?.typeId).toBe('clock')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('shows and adds the Ofelia poop duty widget', async () => {
    render(<AddWidgetMenu />)
    const trigger = screen.getByRole('button', { name: /add widget/i })
    fireEvent.click(trigger)
    expect(await screen.findByRole('menuitem', { name: 'Какахи Офелии' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Какахи Офелии' }))
    expect(instances()).toHaveLength(1)
    expect(instances()[0]?.typeId).toBe('ofelia-poop-duty')
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    render(<AddWidgetMenu />)
    const trigger = screen.getByRole('button', { name: /add widget/i })
    fireEvent.click(trigger)

    const list = await screen.findByRole('menu')
    expect(list).toBeInTheDocument()

    fireEvent.keyDown(list, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('menuitem', { name: /clock/i })).not.toBeInTheDocument()
    })
    expect(trigger).toHaveFocus()
  })
})
