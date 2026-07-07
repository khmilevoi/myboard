import { context } from '@reatom/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  onmessage: ((event: MessageEvent) => void) | null = null
  close = vi.fn()
  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }
}

afterEach(() => {
  FakeEventSource.instances = []
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

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
function createTestModel(devices: DeviceDto[], ...extraResponses: Response[]) {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce(jsonResponse(account))
    .mockResolvedValueOnce(jsonResponse({ devices, thisCredentialId: null }))
  for (const response of extraResponses) fetchImpl.mockResolvedValueOnce(response)

  const model = createAccountModel({
    fetchImpl,
    storage: { get: () => null },
    navigate: vi.fn(),
    eventSourceCtor: FakeEventSource as unknown as typeof EventSource,
  })
  return { model, fetchImpl }
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
    const { model, fetchImpl } = createTestModel(
      [device({ credentialId: 'c1' })],
      new Response(null, { status: 204 }),
    )

    render(<AccountMenu model={model} />)
    await openMenu()
    fireEvent.click(await screen.findByText('Выйти'))

    await waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      )
    })
  })

  it('calls refresh and opens the devices SSE connection on mount', async () => {
    const { model, fetchImpl } = createTestModel([])

    render(<AccountMenu model={model} />)

    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2))
    expect(FakeEventSource.instances).toHaveLength(1)
    expect(FakeEventSource.instances[0]!.url).toBe('/api/auth/devices/events')
  })
})
