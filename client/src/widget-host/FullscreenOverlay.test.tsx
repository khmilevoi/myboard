// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { addInstance, expandedInstanceId, instances } from '../board-model/board-model'
import { FullscreenOverlay } from './FullscreenOverlay'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('FullscreenOverlay', () => {
  it('renders nothing when no instance is expanded', () => {
    const { container } = render(<FullscreenOverlay />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders a large frame for the expanded instance and closes', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    expect(await screen.findByText(/:/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(expandedInstanceId()).toBeNull()
    void instances
  })

  it('closes on Escape', () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(expandedInstanceId()).toBeNull()
  })
})
