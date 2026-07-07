import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAccountModel } from '../model/account-model'
import type { AccountDto, DeviceDto } from '../model/devices-http'
import { MyDevicesDialog } from './MyDevicesDialog'

// Reset BEFORE each test, not after -- matches AccountMenu.test.tsx's documented
// convention: resetting after a test races with @testing-library/react's own
// automatic unmount cleanup for that same test's tree.
beforeEach(() => context.reset())

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function device(overrides: Partial<DeviceDto> & Pick<DeviceDto, 'credentialId'>): DeviceDto {
  return {
    label: 'Chrome on Windows',
    status: 'active',
    addedVia: 'invite',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides,
  }
}

const account: AccountDto = { id: 'acc-1', name: 'Анна Ковалёва', deviceLimit: 3 }

// Seeds the model through the same refresh() flow the model's own public
// contract exposes (matching account-model.test.ts's fetch-mocking
// convention) -- MyDevicesDialog itself never calls refresh() (AccountMenu,
// the sole owner of the model instance, already does that), so seeding via an
// explicit awaited refresh() before render is the correct, race-free setup
// here (unlike AccountMenu.test.tsx, which must go through the component's
// own mount-effect refresh()).
async function createTestModel(
  devices: DeviceDto[],
  accountOverride: AccountDto = account,
  thisCredentialId: string | null = devices[0]?.credentialId ?? null,
) {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(accountOverride))
    .mockResolvedValueOnce(jsonResponse({ devices, thisCredentialId }))
  const model = createAccountModel({
    fetchImpl,
    storage: { get: () => null },
    navigate: vi.fn(),
  })
  await model.refresh()
  return { model, fetchImpl }
}

describe('MyDevicesDialog', () => {
  it('(a) only this device: header, single row with the current-device chip, no revoke button, add-device enabled', async () => {
    const { model } = await createTestModel([device({ credentialId: 'c1' })])

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Мои устройства')).toBeInTheDocument()
    expect(within(dialog).getByText('Анна Ковалёва')).toBeInTheDocument()
    expect(within(dialog).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(dialog).getByText('Это устройство')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Отозвать' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Добавить устройство/ })).toBeEnabled()
  })

  it('(b) three active devices: revoke buttons render only for the two non-current devices', async () => {
    const { model } = await createTestModel(
      [
        device({ credentialId: 'c1', label: 'Chrome on Windows' }),
        device({ credentialId: 'c2', label: 'Safari on iPhone' }),
        device({ credentialId: 'c3', label: 'Firefox on Linux' }),
      ],
      account,
      'c1',
    )

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Chrome on Windows')).toBeInTheDocument()
    expect(within(dialog).getByText('Safari on iPhone')).toBeInTheDocument()
    expect(within(dialog).getByText('Firefox on Linux')).toBeInTheDocument()
    expect(within(dialog).getAllByRole('button', { name: 'Отозвать' })).toHaveLength(2)
  })

  it('(c) pending device: Подтвердить calls model.approve for that device', async () => {
    const { model, fetchImpl } = await createTestModel(
      [
        device({ credentialId: 'c1', label: 'Chrome on Windows' }),
        device({
          credentialId: 'c2',
          label: 'Chrome on Android',
          status: 'pending',
          addedVia: 'add-token',
        }),
      ],
      account,
      'c1',
    )

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Ожидают подтверждения')).toBeInTheDocument()
    expect(within(dialog).getByText('Chrome on Android')).toBeInTheDocument()

    fetchImpl.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchImpl.mockResolvedValueOnce(jsonResponse(account))
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ devices: [device({ credentialId: 'c1' })], thisCredentialId: 'c1' }),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }))

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/auth/devices/c2/approve',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('(c) pending device: Отклонить calls model.deny for that device', async () => {
    const { model, fetchImpl } = await createTestModel(
      [
        device({ credentialId: 'c1', label: 'Chrome on Windows' }),
        device({
          credentialId: 'c2',
          label: 'Chrome on Android',
          status: 'pending',
          addedVia: 'add-token',
        }),
      ],
      account,
      'c1',
    )

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')

    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchImpl.mockResolvedValueOnce(jsonResponse(account))
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ devices: [device({ credentialId: 'c1' })], thisCredentialId: 'c1' }),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отклонить' }))

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/auth/devices/c2/deny',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('(d) revoke requires a second click: first click shows inline confirm without calling revoke, Отмена dismisses it, confirming calls model.revoke', async () => {
    const { model, fetchImpl } = await createTestModel(
      [
        device({ credentialId: 'c1', label: 'Chrome on Windows' }),
        device({ credentialId: 'c2', label: 'Safari on iPhone' }),
      ],
      account,
      'c1',
    )

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отозвать' }))

    await within(dialog).findByText('Отозвать это устройство? Оно потеряет доступ.')
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/auth/devices/c2/revoke', expect.anything())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() =>
      expect(
        within(dialog).queryByText('Отозвать это устройство? Оно потеряет доступ.'),
      ).not.toBeInTheDocument(),
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отозвать' }))
    await within(dialog).findByText('Отозвать это устройство? Оно потеряет доступ.')

    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchImpl.mockResolvedValueOnce(jsonResponse(account))
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ devices: [device({ credentialId: 'c1' })], thisCredentialId: 'c1' }),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Отозвать' }))

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/auth/devices/c2/revoke',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('(e) device limit reached: shows the limit note and disables Add device', async () => {
    const { model } = await createTestModel(
      [
        device({ credentialId: 'c1', label: 'Chrome on Windows' }),
        device({ credentialId: 'c2', label: 'Safari on iPhone' }),
        device({ credentialId: 'c3', label: 'Firefox on Linux' }),
      ],
      account,
      'c1',
    )

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Достигнут лимит устройств')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Добавить устройство/ })).toBeDisabled()
  })

  it('hides the revoke button for the current device even when it is the sole active device', async () => {
    const { model } = await createTestModel([device({ credentialId: 'c1' })], account, 'c1')

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).queryByRole('button', { name: 'Отозвать' })).not.toBeInTheDocument()
  })

  it('does not render dialog content when open is false', async () => {
    const { model } = await createTestModel([device({ credentialId: 'c1' })])

    render(<MyDevicesDialog model={model} open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
