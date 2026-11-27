// @vitest-environment jsdom
import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeGateway, makeHardware, makeSnapshot, makeTestHardwareModel } from '../model/testing'
import { HardwareDialog } from './HardwareDialog'

beforeEach(() => context.reset())

const mine = { index: 1, binding: 'mine' as const }

describe('HardwareDialog', () => {
  it('shows the titled dialog with the list view and a «Закрыть» button', async () => {
    const { model } = makeTestHardwareModel(makeSnapshot())

    render(<HardwareDialog open onOpenChange={vi.fn()} model={model} />)

    const dialog = await screen.findByTestId('hardware-dialog')
    expect(within(dialog).getByRole('heading', { name: 'Оборудование' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
    expect(await within(dialog).findByTestId('hardware-list')).toBeInTheDocument()
    expect(await within(dialog).findByTestId('hardware-primary')).toHaveTextContent('Добавить шлюз')
  })

  it('opens the live stream only while the dialog is open', async () => {
    const { model, streams } = makeTestHardwareModel(makeSnapshot())
    const { rerender } = render(<HardwareDialog open onOpenChange={vi.fn()} model={model} />)

    await waitFor(() => expect(streams).toHaveLength(1))
    expect(streams[0]!.closed).toBe(false)

    rerender(<HardwareDialog open={false} onOpenChange={vi.fn()} model={model} />)

    await waitFor(() => expect(streams[0]!.closed).toBe(true))
  })

  it('closing reports onOpenChange(false) and resets the model (confirm and view)', async () => {
    const { model } = makeTestHardwareModel(
      makeSnapshot([makeGateway()], [makeHardware({ profiles: [mine] })]),
    )
    const onOpenChange = vi.fn()
    render(<HardwareDialog open onOpenChange={onOpenChange} model={model} />)
    await screen.findByTestId('hardware-scale-h1')
    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }))
    expect(model.confirm()).not.toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(model.confirm()).toBeNull()
    expect(model.view()).toBe('list')
  })

  it('the primary buttons switch the view kind', async () => {
    const { model } = makeTestHardwareModel(makeSnapshot())
    render(<HardwareDialog open onOpenChange={vi.fn()} model={model} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить шлюз' }))

    expect(model.view()).toBe('addGateway')
  })
})
