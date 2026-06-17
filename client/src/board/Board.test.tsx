// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { addInstance, instances } from '../board-model/board-model'
import { Board } from './Board'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Board', () => {
  it('shows the empty state when there are no widgets', () => {
    render(<Board />)
    expect(screen.getByText(/no widgets yet/i)).toBeInTheDocument()
  })

  it('renders a card for each instance', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    expect(screen.getByTestId('widget-card')).toBeInTheDocument()
  })

  it('removes a widget via its remove button', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    fireEvent.click(within(card).getByRole('button', { name: /remove/i }))
    expect(instances()).toHaveLength(0)
  })

  it('renders a stable drag handle for grid interactions', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    render(<Board />)
    const card = await screen.findByTestId('widget-card')
    const handle = within(card).getByText('Clock')
    expect(handle).toHaveClass('widget-drag-handle')
  })
})
