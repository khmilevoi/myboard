import { atom, context } from '@reatom/core'
// @vitest-environment jsdom
import type { AuthenticationResponseJSON } from '@simplewebauthn/browser'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAddDeviceModel } from '../model/add-device-model'
import type { DeviceDto } from '../model/devices-http'
import { AddDeviceModal } from './AddDeviceModal'

// Reset BEFORE each test (not after) -- matches MyDevicesDialog.test.tsx's
// documented convention: resetting after a test races with
// @testing-library/react's own automatic unmount cleanup for that test's tree.
beforeEach(() => context.reset())
afterEach(() => vi.useRealTimers())

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const OPTIONS_BODY = { options: { challenge: 'add-token-challenge' } }
const authenticationResponse = { id: 'cred-this' } as unknown as AuthenticationResponseJSON

function mintBody(overrides: Partial<{ expiresAt: number }> = {}) {
  return {
    code: 'ABC123',
    formatted: 'ABC-123',
    url: 'http://localhost:5173/add-device?token=ABC123',
    expiresAt: Date.now() + 5 * 60_000,
    ...overrides,
  }
}

function pendingDeviceFixture(overrides: Partial<DeviceDto> = {}): DeviceDto {
  return {
    credentialId: 'cred-new',
    label: 'Chrome на Android',
    status: 'pending',
    addedVia: 'add-token',
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides,
  }
}

// Mirrors the real account-model.ts contract closely enough for this
// component's tests: `approve`/`deny` remove the device from `pending()`
// (mirroring the real model's approve/deny -> refresh() effect) and never
// throw (they'd set their own `error` atom instead -- not exercised here,
// AddDeviceModal doesn't surface a generic error banner, matching
// MyDevicesDialog.tsx's own established precedent of not rendering
// `model.error()` either).
//
// `pending` MUST be backed by a real reatom atom, not a plain closure --
// add-device-model.ts's `pendingDevice` computed calls `deps.accountModel
// .pending()` without ever reading a raw atom of its own, so it only picks
// up a change reactively if *that* call itself is a genuine reatom read
// (which the real account-model.ts's `pending` is, being itself a
// `computed(...)`). A plain closure returning a captured, later-mutated
// array (this file's very first draft) has no reatom dependency for
// `pendingDevice` to track, so once a mounted component "connects" it, it
// caches the first read forever and never notices the underlying array
// changing -- this is what caused an approve()/deny() test to hang
// indefinitely (the dialog never left the (c) approval-card render).
function createFakeAccountModel(initialPending: DeviceDto[] = []) {
  const pending = atom<DeviceDto[]>(initialPending, 'test.fakeAccountModel.pending')
  return {
    pending: () => pending(),
    error: () => null,
    approve: vi.fn(async (credentialId: string) => {
      pending.set(pending().filter((device) => device.credentialId !== credentialId))
    }),
    deny: vi.fn(async (credentialId: string) => {
      pending.set(pending().filter((device) => device.credentialId !== credentialId))
    }),
  }
}

describe('AddDeviceModal', () => {
  it('(a) confirm identity: Подтвердить calls model.start()', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
    })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Подтвердите личность, чтобы создать код')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: /Подтвердить/ }))

    await waitFor(() =>
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/auth/devices/add-token/options',
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it('shows a disabled, loading Подтвердить button while verifying', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      // Never resolves -- keeps phase pinned at 'verifying' for the assertion.
      startAuthenticationCeremony: vi.fn(() => new Promise<AuthenticationResponseJSON>(() => {})),
      accountModel: createFakeAccountModel(),
    })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: /Подтвердить/ }))

    await within(dialog).findByText('Подтверждение…')
    expect(within(dialog).getByRole('button', { name: /Подтверждение/ })).toBeDisabled()
  })

  it('(b) shows the QR, formatted code, and countdown once a code is minted', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
    })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)
    await model.start()

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Добавить устройство')).toBeInTheDocument()
    expect(within(dialog).getByText('ABC-123')).toBeInTheDocument()
    expect(within(dialog).getByText(/Код активен ещё/)).toBeInTheDocument()
    // Smoke-checks the real qr-code-styling SVG was appended into the DOM --
    // not asserting on its exact pixel content. Queried from `dialog` (found
    // via `screen`, which searches the whole document) rather than
    // `render()`'s own `container` -- Radix's DialogPortal mounts content
    // into `document.body` outside that container.
    expect(dialog.querySelector('svg')).toBeTruthy()
  })

  it('copies the mint url to the clipboard when Скопировать ссылку is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
    })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)
    await model.start()
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: /Скопировать ссылку/ }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(model.url()))
  })

  it('(c) flips to the approval card for a pending device; Отклонить calls model.deny for it', async () => {
    const pendingDevice = pendingDeviceFixture()
    const accountModel = createFakeAccountModel([pendingDevice])
    const model = createAddDeviceModel({ accountModel })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Устройство хочет присоединиться')).toBeInTheDocument()
    expect(within(dialog).getByText('Chrome на Android')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Отклонить' }))

    await waitFor(() => expect(accountModel.deny).toHaveBeenCalledWith('cred-new'))
  })

  it('(e) shows the device-added success card once Подтвердить succeeds', async () => {
    const pendingDevice = pendingDeviceFixture()
    const accountModel = createFakeAccountModel([pendingDevice])
    const model = createAddDeviceModel({ accountModel })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)
    const dialog = await screen.findByRole('dialog')

    fireEvent.click(within(dialog).getByRole('button', { name: 'Подтвердить' }))

    await within(dialog).findByText('Устройство добавлено')
    expect(
      within(dialog).getByText('Chrome на Android теперь может входить в аккаунт'),
    ).toBeInTheDocument()
    expect(accountModel.approve).toHaveBeenCalledWith('cred-new')
  })

  it('(d) shows the expired card once the countdown reaches 0:00; Создать новый код mints a fresh one', async () => {
    // Only fake what add-device-model.ts's ticking `now` atom actually uses
    // (`setInterval`/`Date`) -- faking the *default* full timer set (which
    // also covers `setTimeout`) blocks React's own scheduler and
    // testing-library's `waitFor`/`findBy*` (both poll via a real
    // `setTimeout` internally) from ever flushing a re-render, so the DOM
    // would never reflect the countdown reaching 0:00 at all.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'))
    const expiresAt = Date.now() + 5_000
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody({ expiresAt })))
    const model = createAddDeviceModel({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      startAuthenticationCeremony: vi.fn(async () => authenticationResponse),
      accountModel: createFakeAccountModel(),
    })

    render(<AddDeviceModal model={model} open onOpenChange={vi.fn()} />)
    await model.start()

    vi.advanceTimersByTime(6_000)

    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('Срок действия кода истёк')

    fetchImpl
      .mockResolvedValueOnce(jsonResponse(OPTIONS_BODY))
      .mockResolvedValueOnce(jsonResponse(mintBody()))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Создать новый код' }))

    await waitFor(() => expect(within(dialog).getByText('Добавить устройство')).toBeInTheDocument())
  })

  it('does not render dialog content when open is false', () => {
    const model = createAddDeviceModel({ accountModel: createFakeAccountModel() })

    render(<AddDeviceModal model={model} open={false} onOpenChange={vi.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
