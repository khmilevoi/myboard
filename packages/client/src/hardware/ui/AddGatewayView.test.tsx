// @vitest-environment jsdom
import { context } from '@reatom/core'
import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { makeHardwareBoardClient } from '@shared/hardware/board-client'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeAddGatewayModel } from '../model/add-gateway-model'
import { makeHardwareModel } from '../model/hardware-model'
import { makeGateway, makeSnapshot, TEST_NOW } from '../model/testing'
import { AddGatewayView } from './AddGatewayView'
import { HardwareDialog } from './HardwareDialog'

beforeEach(() => context.reset())

const CODE = 'K7QP-3M9X'
const mint = (expiresAt: number): ScriptedStep => ({ status: 201, body: { code: CODE, expiresAt } })

function setup(options: {
  snapshots: HardwareSnapshot[]
  mints?: ScriptedStep[]
  clipboard?: { writeText: (text: string) => Promise<void> }
}) {
  const { http } = makeScriptedHttp({
    '/api/hardware': options.snapshots.map((body) => ({ status: 200, body })),
    '/api/hardware/codes': options.mints ?? [mint(TEST_NOW + 292_000)],
  })
  const { open } = makeFakeOpenEventStream()
  const client = makeHardwareBoardClient(http)
  const hardware = makeHardwareModel({ client, openEventStream: open, now: () => TEST_NOW })
  const addGateway = makeAddGatewayModel({ hardware, client, clipboard: options.clipboard })
  return { hardware, addGateway }
}

const callbacks = () => ({ onAddHardware: vi.fn(), onDone: vi.fn() })

describe('AddGatewayView (§3)', () => {
  it('(a) waiting: explanation, mono code, copy button, spinner and countdown hint', async () => {
    const { addGateway } = setup({ snapshots: [makeSnapshot()] })
    render(<AddGatewayView model={addGateway} {...callbacks()} />)
    void addGateway.start()

    expect(await screen.findByTestId('hardware-gateway-code')).toHaveTextContent(CODE)
    expect(screen.getByTestId('hardware-add-gateway')).toHaveAttribute('data-phase', 'waiting')
    expect(screen.getByText(/Запустите шлюз на Raspberry Pi/)).toBeInTheDocument()
    expect(screen.getByTestId('hardware-waiting')).toHaveTextContent('Ждём шлюз…')
    expect(screen.getByTestId('hardware-countdown')).toHaveTextContent('Код активен ещё 4:52')
    expect(screen.getByRole('button', { name: 'Скопировать код' })).toBeInTheDocument()
  })

  it('«Скопировать код» writes the code and the label flips to «Скопировано»', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { addGateway } = setup({ snapshots: [makeSnapshot()], clipboard: { writeText } })
    render(<AddGatewayView model={addGateway} {...callbacks()} />)
    void addGateway.start()
    await screen.findByTestId('hardware-gateway-code')

    fireEvent.click(screen.getByRole('button', { name: 'Скопировать код' }))

    expect(await screen.findByRole('button', { name: 'Скопировано' })).toBeInTheDocument()
    expect(writeText).toHaveBeenCalledWith(CODE)
  })

  it('(b) connected: «Шлюз подключён», «Добавить оборудование» and «Готово» call back', async () => {
    const { addGateway, hardware } = setup({
      snapshots: [makeSnapshot(), makeSnapshot([makeGateway({ id: 'g2', online: true })])],
    })
    const cb = callbacks()
    render(<AddGatewayView model={addGateway} {...cb} />)
    void addGateway.start()
    await screen.findByTestId('hardware-gateway-code')

    hardware.refresh()
    expect(await screen.findByText('Шлюз подключён')).toBeInTheDocument()
    expect(screen.getByTestId('hardware-add-gateway')).toHaveAttribute('data-phase', 'connected')
    fireEvent.click(screen.getByRole('button', { name: 'Добавить оборудование' }))
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))

    expect(cb.onAddHardware).toHaveBeenCalledTimes(1)
    expect(cb.onDone).toHaveBeenCalledTimes(1)
  })

  it('(c) expired: «Срок действия кода истёк» and «Новый код» mints again', async () => {
    const { addGateway } = setup({
      snapshots: [makeSnapshot()],
      mints: [mint(TEST_NOW - 1), mint(TEST_NOW + 300_000)],
    })
    render(<AddGatewayView model={addGateway} {...callbacks()} />)
    void addGateway.start()

    expect(await screen.findByText('Срок действия кода истёк')).toBeInTheDocument()
    expect(screen.getByTestId('hardware-add-gateway')).toHaveAttribute('data-phase', 'expired')
    fireEvent.click(screen.getByRole('button', { name: 'Новый код' }))

    expect(await screen.findByTestId('hardware-gateway-code')).toHaveTextContent(CODE)
  })

  it('failed: shows the error text and «Новый код»', async () => {
    const { addGateway } = setup({
      snapshots: [makeSnapshot()],
      mints: [{ status: 500, body: {} }, mint(TEST_NOW + 300_000)],
    })
    render(<AddGatewayView model={addGateway} {...callbacks()} />)
    void addGateway.start()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Не получилось. Попробуйте ещё раз.')
    expect(screen.getByTestId('hardware-add-gateway')).toHaveAttribute('data-phase', 'failed')
    fireEvent.click(screen.getByRole('button', { name: 'Новый код' }))

    expect(await screen.findByTestId('hardware-gateway-code')).toBeInTheDocument()
  })
})

describe('HardwareDialog add-gateway flow', () => {
  function dialog(snapshots: HardwareSnapshot[]) {
    const env = setup({ snapshots })
    const wizard = { openScan: vi.fn(), close: vi.fn() }
    render(
      <HardwareDialog
        open
        onOpenChange={vi.fn()}
        model={env.hardware}
        addGatewayModel={env.addGateway}
        wizardModel={wizard as never}
      />,
    )
    return { ...env, wizard }
  }

  it('«Добавить шлюз» opens the view with the «Добавить шлюз» title and a minted code', async () => {
    dialog([makeSnapshot()])

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить шлюз' }))

    expect(await screen.findByTestId('hardware-gateway-code')).toHaveTextContent(CODE)
    expect(screen.getByRole('heading', { name: 'Добавить шлюз' })).toBeInTheDocument()
  })

  it('«Добавить оборудование» switches to the wizard and opens the scan on the online gateway', async () => {
    const env = dialog([makeSnapshot(), makeSnapshot([makeGateway({ id: 'g2', online: true })])])
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить шлюз' }))
    await screen.findByTestId('hardware-gateway-code')
    env.hardware.refresh()

    fireEvent.click(await screen.findByRole('button', { name: 'Добавить оборудование' }))

    expect(env.wizard.openScan).toHaveBeenCalledWith('g2')
    expect(env.hardware.view()).toBe('wizard')
  })

  it('«Готово» returns to the list', async () => {
    const env = dialog([makeSnapshot(), makeSnapshot([makeGateway({ id: 'g2', online: true })])])
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить шлюз' }))
    await screen.findByTestId('hardware-gateway-code')
    env.hardware.refresh()

    fireEvent.click(await screen.findByRole('button', { name: 'Готово' }))

    await waitFor(() => expect(env.hardware.view()).toBe('list'))
    expect(await screen.findByTestId('hardware-list')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Оборудование' })).toBeInTheDocument()
  })
})
