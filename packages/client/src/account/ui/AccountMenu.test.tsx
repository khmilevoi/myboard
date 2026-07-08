import { context } from '@reatom/core'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAccountModel } from '../model/account-model'
import type { AccountDto, DeviceDto } from '../model/devices-http'
import { AccountMenu } from './AccountMenu'

// Reset BEFORE each test (not after) -- matches board/ui/AddWidgetMenu.test.tsx's
// established convention for reatomMemo component tests: resetting after a
// test races with @testing-library/react's own automatic unmount cleanup for
// that same test's tree (the reset can tear down reatom's internal state
// before React finishes running that tree's unmount effects).
beforeEach(() => context.reset())

function device(overrides: Partial<DeviceDto> & Pick<DeviceDto, 'credentialId'>): DeviceDto {
  return {
    label: 'Device',
    status: 'active',
    addedVia: 'invite',
    createdAt: 1,
    lastSeenAt: 1,
    ...overrides,
  }
}

const account: AccountDto = { id: 'acc-1', name: 'Анна Ковалёва', deviceLimit: 5 }

// Seeds the model through the same refresh() flow the component's own mount
// effect drives (matching account-model.test.ts's fetch-mocking convention)
// instead of poking `model.account`/`model.devices` directly -- the
// component always calls `refresh()` on mount, so a manual `.set()` would
// just be raced and overwritten once that call resolves.
function createTestModel(devices: DeviceDto[], logoutSteps: ScriptedStep[] = []) {
  const { http, calls } = makeScriptedHttp({
    '/api/auth/account': [{ status: 200, body: account }],
    '/api/auth/devices': [{ status: 200, body: { devices, thisCredentialId: null } }],
  })
  const bareHttp = makeScriptedHttp({ '/api/auth/logout': logoutSteps }).http
  const { open: openEventStream, streams } = makeFakeOpenEventStream()

  const model = createAccountModel({
    http,
    bareHttp,
    // Not exercising purge behavior here (account-model.test.ts owns that) --
    // a no-op avoids the real purgeLocalSession's Dexie db.delete() leaking a
    // closed shared `db` singleton into this file's other tests.
    purge: vi.fn(async () => undefined),
    storage: { get: () => null },
    navigate: vi.fn(),
    openEventStream,
  })
  return { model, calls, streams }
}

async function findTrigger() {
  return screen.findByRole('button', { name: 'Анна Ковалёва' })
}

async function openMenu() {
  const trigger = await findTrigger()
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
}

describe('AccountMenu', () => {
  it('(a) renders the closed avatar with initials from the account name and no badge', async () => {
    const { model } = createTestModel([device({ credentialId: 'c1' })])

    render(<AccountMenu model={model} />)

    const trigger = await findTrigger()
    expect(trigger).toHaveTextContent('АК')
    expect(screen.queryByTestId('account-menu-badge')).not.toBeInTheDocument()
    expect(screen.queryByText('Мои устройства')).not.toBeInTheDocument()
  })

  it('(b) opens the dropdown on trigger interaction and shows the account name, device count and both menu items', async () => {
    const { model } = createTestModel([
      device({ credentialId: 'c1' }),
      device({ credentialId: 'c2' }),
      device({ credentialId: 'c3' }),
    ])

    render(<AccountMenu model={model} />)
    expect(screen.queryByText('Мои устройства')).not.toBeInTheDocument()

    await openMenu()

    expect(await screen.findByText('3 устройства')).toBeInTheDocument()
    expect(screen.getAllByText('Анна Ковалёва').length).toBeGreaterThan(0)
    expect(screen.getByText('Мои устройства')).toBeInTheDocument()
    expect(screen.getByText('Выйти')).toBeInTheDocument()
  })

  it('(c) shows a badge dot and a pluralized pending-request row when devices are pending', async () => {
    const { model } = createTestModel([
      device({ credentialId: 'c1' }),
      device({ credentialId: 'c2', status: 'pending', addedVia: 'add-token' }),
      device({ credentialId: 'c3', status: 'pending', addedVia: 'add-token' }),
    ])

    render(<AccountMenu model={model} />)
    await findTrigger()
    expect(screen.getByTestId('account-menu-badge')).toBeInTheDocument()

    await openMenu()

    expect(await screen.findByText('2 запроса на подключение')).toBeInTheDocument()
  })

  it('calls logout when the "Выйти" item is selected', async () => {
    const { model } = createTestModel([device({ credentialId: 'c1' })], [{ status: 204 }])

    render(<AccountMenu model={model} />)
    await openMenu()
    fireEvent.click(await screen.findByText('Выйти'))

    await waitFor(() => expect(model.error()).toBeNull())
  })

  it('calls refresh and opens the devices SSE connection on mount', async () => {
    const { model, calls, streams } = createTestModel([])

    render(<AccountMenu model={model} />)

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(2))
    expect(streams).toHaveLength(1)
    expect(streams[0]!.url).toBe('/api/auth/devices/events')
  })

  it('opens MyDevicesDialog (sharing this same model) when "Мои устройства" is selected', async () => {
    const { model } = createTestModel([device({ credentialId: 'c1', label: 'Chrome on Windows' })])

    render(<AccountMenu model={model} />)
    await openMenu()
    fireEvent.click(await screen.findByText('Мои устройства'))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getAllByText('Анна Ковалёва').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('Chrome on Windows')).toBeInTheDocument()
  })
})
