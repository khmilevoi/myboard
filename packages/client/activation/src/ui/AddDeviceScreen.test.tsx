import { context } from '@reatom/core'
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAddDeviceModel } from '../model/add-device-model'
import { AddDeviceScreen } from './AddDeviceScreen'

// `beforeEach` (not `afterEach`) -- matches AccountMenu.test.tsx's documented
// precedent: `afterEach(() => context.reset())` races with
// @testing-library/react's own auto-registered unmount cleanup and crashes
// with "Cannot read properties of undefined (reading 'pubs')" during React's
// passive-unmount effects for a reatomMemo-wrapped component.
beforeEach(() => context.reset())

describe('AddDeviceScreen', () => {
  it('extracts the code from a pasted add-device link, submits it, and does not leave the raw URL in the field', () => {
    const model = createAddDeviceModel({
      currentOrigin: 'https://host',
      fetchImpl: vi.fn() as unknown as typeof fetch,
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
