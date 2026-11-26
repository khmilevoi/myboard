import { context, notify } from '@reatom/core'
import { makeScriptedHttp } from '@shared/http/test/scripted-http'
// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { type AddDeviceModel, makeAddDeviceModel, type ScanStatus } from '../model/add-device-model'
import { AddDeviceScreen } from './AddDeviceScreen'

// `beforeEach` (not `afterEach`) -- matches AccountMenu.test.tsx's documented
// precedent: `afterEach(() => context.reset())` races with
// @testing-library/react's own auto-registered unmount cleanup and crashes
// with "Cannot read properties of undefined (reading 'pubs')" during React's
// passive-unmount effects for a reatomMemo-wrapped component.
beforeEach(() => context.reset())

describe('AddDeviceScreen', () => {
  it('extracts the code from a pasted add-device link, submits it, and does not leave the raw URL in the field', () => {
    const model = makeAddDeviceModel({
      currentOrigin: 'https://host',
      http: makeScriptedHttp({}).http,
    })
    const submitManual = vi.spyOn(model, 'submitManual').mockImplementation(async () => {})

    render(<AddDeviceScreen model={model} />)

    const input = screen.getByLabelText('Код с другого устройства')
    fireEvent.paste(input, {
      clipboardData: {
        getData: () => 'https://host/add-device?token=K7QP-3M9X',
      },
    })

    expect(submitManual).toHaveBeenCalledWith('K7QP3M9X')
    expect(input).not.toHaveValue('https://host/add-device?token=K7QP-3M9X')
  })
})

// The real hook opens the camera and loads the wasm decoder, neither of which
// exists under jsdom; the overlay only needs a ref for its <video>.
vi.mock('react-zxing', () => ({
  useZxing: () => ({ ref: { current: null } }),
}))

function setStatus(model: AddDeviceModel, status: ScanStatus) {
  act(() => {
    model.scanStatus.set(status)
    notify()
  })
}

describe('AddDeviceScreen scanner feedback', () => {
  function renderScanner() {
    const model = makeAddDeviceModel({
      currentOrigin: 'https://host',
      scan: true,
      http: makeScriptedHttp({}).http,
    })
    render(<AddDeviceScreen model={model} />)
    return model
  }

  it('shows the checking pill with the decoded code', () => {
    const model = renderScanner()

    setStatus(model, { kind: 'checking', code: 'K7QP3M9X' })

    expect(screen.getByRole('status')).toHaveTextContent('Проверяем код…')
    expect(screen.getByText('Код K7QP-3M9X')).toBeInTheDocument()
  })

  it('names both hosts for a code minted on another origin and rescans on request', () => {
    const model = renderScanner()

    setStatus(model, { kind: 'other-origin', codeHost: 'board.example', currentHost: 'host' })

    expect(screen.getByRole('alert')).toHaveTextContent('QR-код с другого адреса')
    expect(screen.getByRole('alert')).toHaveTextContent('board.example')
    fireEvent.click(screen.getByRole('button', { name: 'Сканировать снова' }))
    expect(model.scanStatus()).toEqual({ kind: 'idle' })
  })

  it('offers manual entry from a rejected code', () => {
    const model = renderScanner()

    setStatus(model, { kind: 'rejected', code: 'K7QP3M9X' })

    expect(screen.getByRole('alert')).toHaveTextContent('Код не подходит')
    fireEvent.click(screen.getByRole('button', { name: 'Ввести код вручную' }))
    expect(model.mode()).toBe('manual')
  })

  it('retries after a network failure', () => {
    const model = renderScanner()
    const retryScan = vi.spyOn(model, 'retryScan').mockImplementation(async () => {})

    setStatus(model, { kind: 'network', code: 'K7QP3M9X' })

    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось проверить код')
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    expect(retryScan).toHaveBeenCalledOnce()
  })

  it('shows the foreign-QR notice without blocking the scanner', () => {
    const model = renderScanner()

    setStatus(model, { kind: 'foreign' })

    expect(screen.getByRole('status')).toHaveTextContent('Это не QR-код myboard')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
