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

  it('(b) three active devices: revoke buttons render for all three, including the current device', async () => {
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
    // The server's LastActiveDeviceError guard only blocks revoking a device
    // when activeCount <= 1 -- it has no special case for the caller's own
    // device. With 3 active devices (including the current one), the server
    // allows revoking any of them, so this dialog must offer all 3 buttons.
    expect(within(dialog).getAllByRole('button', { name: 'Отозвать' })).toHaveLength(3)
  })

  it('shows an enabled revoke button for the current device when 2+ active devices exist', async () => {
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
    const currentDeviceRow = within(dialog).getByTestId('device-row-c1')
    const revokeButton = within(currentDeviceRow).getByRole('button', { name: 'Отозвать' })
    expect(revokeButton).toBeEnabled()

    fireEvent.click(revokeButton)
    await within(dialog).findByText('Отозвать это устройство? Оно потеряет доступ.')

    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchImpl.mockResolvedValueOnce(jsonResponse(account))
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ devices: [device({ credentialId: 'c2' })], thisCredentialId: null }),
    )
    // Scoped to c1's row -- c2's own normal row still has its own visible
    // "Отозвать" button while c1's is in confirm mode, so an unscoped query
    // would be ambiguous.
    fireEvent.click(
      within(within(dialog).getByTestId('device-row-c1')).getByRole('button', {
        name: 'Отозвать',
      }),
    )

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/auth/devices/c1/revoke',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
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
    // Scoped to c2's row throughout -- with 2 active devices, c1 (current)
    // now also has its own visible "Отозвать" button (see the dedicated
    // current-device-with-2+-actives test above), so unscoped queries would
    // be ambiguous.
    const c2Row = within(dialog).getByTestId('device-row-c2')
    fireEvent.click(within(c2Row).getByRole('button', { name: 'Отозвать' }))

    await within(dialog).findByText('Отозвать это устройство? Оно потеряет доступ.')
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/auth/devices/c2/revoke', expect.anything())

    fireEvent.click(
      within(within(dialog).getByTestId('device-row-c2')).getByRole('button', {
        name: 'Отмена',
      }),
    )
    await waitFor(() =>
      expect(
        within(dialog).queryByText('Отозвать это устройство? Оно потеряет доступ.'),
      ).not.toBeInTheDocument(),
    )

    fireEvent.click(
      within(within(dialog).getByTestId('device-row-c2')).getByRole('button', {
        name: 'Отозвать',
      }),
    )
    await within(dialog).findByText('Отозвать это устройство? Оно потеряет доступ.')

    fetchImpl.mockResolvedValueOnce(new Response(null, { status: 204 }))
    fetchImpl.mockResolvedValueOnce(jsonResponse(account))
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ devices: [device({ credentialId: 'c1' })], thisCredentialId: 'c1' }),
    )
    fireEvent.click(
      within(within(dialog).getByTestId('device-row-c2')).getByRole('button', {
        name: 'Отозвать',
      }),
    )

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

  // Task B6 wiring: "Добавить устройство" opens AddDeviceModal, sharing this
  // dialog's own `model` instance via `createAddDeviceModel({ accountModel:
  // model })` -- not strictly red-first (see task-B5-report.md's identical
  // precedent for its own AccountMenu.tsx wiring test): the wiring itself is
  // a small, directly-observable compositional JSX change reusing
  // AddDeviceModal.tsx's already-TDD'd behavior.
  //
  // Asserts on text becoming visible via plain `screen.findByText`, not on
  // "a second dialog role" -- Radix marks the *background* Dialog.Root
  // `aria-hidden="true"` once a second, nested one opens (correct
  // accessibility behavior: only the now-topmost AddDeviceModal should be
  // exposed to assistive tech), and testing-library's role queries exclude
  // `aria-hidden` elements by default, so a `role="dialog"` query for the
  // *new* dialog while the old one still (transiently) has that attribute
  // is unreliable; plain text queries aren't affected by that filtering.
  it('Добавить устройство opens AddDeviceModal wired to the same account model', async () => {
    const { model } = await createTestModel([device({ credentialId: 'c1' })])

    render(<MyDevicesDialog model={model} open onOpenChange={vi.fn()} />)

    await screen.findByText('Мои устройства')

    fireEvent.click(screen.getByRole('button', { name: /Добавить устройство/ }))

    await screen.findByText('Подтвердите личность, чтобы создать код')
  })

  it('AddDeviceModal reads the shared model.pending, flipping straight to the approval card for an already-pending device', async () => {
    const { model } = await createTestModel(
      [
        device({ credentialId: 'c1' }),
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
    await screen.findByText('Мои устройства')

    fireEvent.click(screen.getByRole('button', { name: /Добавить устройство/ }))

    await screen.findByText('Устройство хочет присоединиться')
  })

  it('resets AddDeviceModal back to idle after closing, so reopening starts a fresh ceremony instead of dead-ending on the previous success card', async () => {
    const { model, fetchImpl } = await createTestModel(
      [
        device({ credentialId: 'c1' }),
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
    await screen.findByText('Мои устройства')

    fireEvent.click(screen.getByRole('button', { name: /Добавить устройство/ }))
    await screen.findByText('Устройство хочет присоединиться')

    fetchImpl.mockResolvedValueOnce(jsonResponse({ ok: true }))
    fetchImpl.mockResolvedValueOnce(jsonResponse(account))
    fetchImpl.mockResolvedValueOnce(
      jsonResponse({ devices: [device({ credentialId: 'c1' })], thisCredentialId: 'c1' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Подтвердить' }))
    await screen.findByText('Устройство добавлено')

    // Close AddDeviceModal (its own X button -- MyDevicesDialog's own is
    // aria-hidden while AddDeviceModal is on top, so this unambiguously
    // resolves to AddDeviceModal's).
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    await waitFor(() => expect(screen.queryByText('Устройство добавлено')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Добавить устройство/ }))

    await screen.findByText('Подтвердите личность, чтобы создать код')
  })
})
