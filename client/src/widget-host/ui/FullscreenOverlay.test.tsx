// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { addInstance, expandedInstanceId } from '../../board/model/board-model'
import { FullscreenOverlay } from './FullscreenOverlay'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('FullscreenOverlay', () => {
  it('renders nothing when no instance is expanded', () => {
    const { container } = render(<FullscreenOverlay />)
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders a large frame for the expanded instance and closes via the close button', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(await screen.findByText(/:/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(expandedInstanceId()).toBeNull()
  })

  it('closes on Escape', async () => {
    const id = addInstance('clock')
    if (id instanceof Error) throw id
    expandedInstanceId.set(id)

    render(<FullscreenOverlay />)
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(expandedInstanceId()).toBeNull()
  })
})
