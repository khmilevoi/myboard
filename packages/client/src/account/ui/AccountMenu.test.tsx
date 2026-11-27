import { context } from '@reatom/core'
import { makeFakeOpenEventStream } from '@shared/http/test/fake-event-stream'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeAvatarCropModel } from 'widget-sdk/files/avatar-crop-model'

import { createAccountModel } from '../model/account-model'
import { describeAvatarError } from '../model/avatar-http'
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

  it('(b) opens the dropdown on trigger interaction and shows the account name, device count and the menu items', async () => {
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

  it('lists Профиль above Мои устройства, then Выйти', async () => {
    const { model } = createTestModel([device({ credentialId: 'c1' })])

    render(<AccountMenu model={model} />)
    await openMenu()

    const items = (await screen.findAllByRole('menuitem')).map((item) => item.textContent)
    expect(items).toEqual(['Профиль', 'Мои устройства', 'Выйти'])
  })

  it('opens the devices dialog over the profile; closing it returns to the profile', async () => {
    const { model } = createTestModel([device({ credentialId: 'c1', label: 'Chrome on Windows' })])

    render(<AccountMenu model={model} />)
    await openMenu()
    fireEvent.click(await screen.findByTestId('account-menu-profile'))

    const profile = await screen.findByTestId('profile-dialog')
    expect(within(profile).getByRole('heading', { name: 'Профиль' })).toBeInTheDocument()

    fireEvent.click(within(profile).getByTestId('profile-open-devices'))

    const devices = await screen.findByTestId('my-devices-dialog')
    expect(within(devices).getByText('Chrome on Windows')).toBeInTheDocument()
    // Stacked, not replaced: the profile stays open underneath.
    expect(screen.getByTestId('profile-dialog')).toBeInTheDocument()

    fireEvent.click(within(devices).getByRole('button', { name: 'Закрыть' }))

    await waitFor(() => expect(screen.queryByTestId('my-devices-dialog')).toBeNull())
    expect(screen.getByTestId('profile-dialog')).toBeInTheDocument()
  })

  it('opens the devices dialog from the menu on its own, without a profile', async () => {
    const { model } = createTestModel([device({ credentialId: 'c1', label: 'Chrome on Windows' })])

    render(<AccountMenu model={model} />)
    await openMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Мои устройства' }))

    expect(await screen.findByTestId('my-devices-dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('profile-dialog')).toBeNull()
  })

  describe('avatar', () => {
    const AVATAR_URL = '/files/AvatarAvatarAvatar01'
    const avatarRef = {
      blobId: 'AvatarAvatarAvatar01',
      url: AVATAR_URL,
      mime: 'image/webp',
      size: 4,
      updatedAt: 1,
    }

    function createAvatarModel(accountSteps: ScriptedStep[], avatarSteps: ScriptedStep[] = []) {
      const devices = { devices: [device({ credentialId: 'c1' })], thisCredentialId: null }
      const { http, calls } = makeScriptedHttp({
        '/api/auth/account': accountSteps,
        '/api/auth/devices': accountSteps.map(() => ({ status: 200, body: devices })),
        '/api/files/account/avatar': avatarSteps,
      })
      const refreshIdentity = vi.fn(async () => {})
      const prepared = new Blob(['webp'], { type: 'image/webp' })
      const prepareImage = vi.fn(async () => prepared)
      const model = createAccountModel({
        http,
        bareHttp: makeScriptedHttp({}).http,
        purge: vi.fn(async () => undefined),
        storage: { get: () => null },
        navigate: vi.fn(),
        openEventStream: makeFakeOpenEventStream().open,
        prepareImage,
        refreshIdentity,
      })
      const cropModel = makeAvatarCropModel({
        upload: model.uploadAvatar,
        describeError: describeAvatarError,
        readImageSize: async () => ({ width: 400, height: 300 }),
        createObjectUrl: () => 'blob:picked',
        revokeObjectUrl: vi.fn(),
      })
      return { model, cropModel, calls, refreshIdentity, prepareImage, prepared }
    }

    function pick(file: File) {
      fireEvent.change(screen.getByTestId('account-avatar-input'), { target: { files: [file] } })
    }

    it('shows the photo in the trigger and the head; the menu keeps only the camera badge', async () => {
      const { model, cropModel } = createAvatarModel([
        { status: 200, body: { ...account, avatarUrl: AVATAR_URL } },
      ])

      render(<AccountMenu model={model} cropModel={cropModel} />)
      const trigger = await findTrigger()
      await waitFor(() =>
        expect(within(trigger).getByTestId('account-avatar-image')).toHaveAttribute(
          'src',
          AVATAR_URL,
        ),
      )
      expect(trigger).not.toHaveTextContent('АК')

      await openMenu()
      expect(await screen.findByTestId('account-menu-head-avatar')).toHaveAttribute(
        'src',
        AVATAR_URL,
      )
      expect(screen.getByTestId('account-avatar-badge')).toHaveAccessibleName('Сменить фото')
      expect(screen.queryByText('Удалить фото')).toBeNull()
      expect(screen.queryByRole('menuitem', { name: /фото/ })).toBeNull()
    })

    it('shows initials without a photo; the picker accepts the avatar types', async () => {
      const { model, cropModel } = createAvatarModel([{ status: 200, body: account }])

      render(<AccountMenu model={model} cropModel={cropModel} />)
      const trigger = await findTrigger()
      expect(within(trigger).queryByTestId('account-avatar-image')).toBeNull()
      await openMenu()
      expect(await screen.findByTestId('account-avatar-badge')).toHaveAccessibleName(
        'Загрузить фото',
      )
      expect(screen.queryByTestId('account-menu-head-avatar')).not.toBeInTheDocument()
      expect(screen.getByTestId('account-avatar-input')).toHaveAttribute(
        'accept',
        'image/png,image/jpeg,image/webp',
      )
    })

    it('badge → file → crop dialog → Сохранить uploads the crop and shows the new photo', async () => {
      const { model, cropModel, calls, refreshIdentity, prepareImage, prepared } =
        createAvatarModel(
          [
            { status: 200, body: account },
            { status: 200, body: { ...account, avatarUrl: AVATAR_URL } },
          ],
          [{ status: 200, body: { value: avatarRef } }],
        )

      render(<AccountMenu model={model} cropModel={cropModel} />)
      const trigger = await findTrigger()
      await openMenu()
      const input = screen.getByTestId('account-avatar-input') as HTMLInputElement
      const click = vi.spyOn(input, 'click').mockImplementation(() => {})
      fireEvent.click(await screen.findByTestId('account-avatar-badge'))
      expect(click).toHaveBeenCalledTimes(1)

      const file = new File(['jpeg'], 'me.jpg', { type: 'image/jpeg' })
      pick(file)

      const crop = await screen.findByTestId('avatar-crop-dialog')
      await waitFor(() => expect(screen.queryByText('Мои устройства')).toBeNull())
      expect(within(crop).getByText('Анна отметил(а) уборку')).toBeInTheDocument()
      fireEvent.click(await within(crop).findByTestId('avatar-crop-save'))

      await waitFor(() =>
        expect(within(trigger).getByTestId('account-avatar-image')).toHaveAttribute(
          'src',
          AVATAR_URL,
        ),
      )
      // 400×300 at zoom 1: the centred 300 px square.
      expect(prepareImage).toHaveBeenCalledWith(file, { x: 50, y: 0, size: 300 })
      expect(calls.find((call) => call.method === 'PUT')?.body).toBe(prepared)
      expect(refreshIdentity).toHaveBeenCalled()
      await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).toBeNull())
    })

    it('opens the crop over the profile, and cancelling it leaves the profile open', async () => {
      const { model, cropModel } = createAvatarModel([
        { status: 200, body: { ...account, avatarUrl: AVATAR_URL } },
      ])

      render(<AccountMenu model={model} cropModel={cropModel} />)
      await openMenu()
      fireEvent.click(await screen.findByTestId('account-menu-profile'))
      const profile = await screen.findByTestId('profile-dialog')
      const input = screen.getByTestId('account-avatar-input') as HTMLInputElement
      const click = vi.spyOn(input, 'click').mockImplementation(() => {})

      fireEvent.click(within(profile).getByTestId('profile-change-photo'))
      expect(click).toHaveBeenCalledTimes(1)
      pick(new File(['png'], 'me.png', { type: 'image/png' }))

      const crop = await screen.findByTestId('avatar-crop-dialog')
      fireEvent.click(within(crop).getByRole('button', { name: 'Отмена' }))

      await waitFor(() => expect(screen.queryByTestId('avatar-crop-dialog')).toBeNull())
      expect(screen.getByTestId('profile-dialog')).toBeInTheDocument()
    })

    it('shows a rejected upload in the crop dialog, not in the menu', async () => {
      const { model, cropModel } = createAvatarModel(
        [{ status: 200, body: account }],
        [{ status: 415, body: { error: { code: 'file_type_rejected', message: 'x' } } }],
      )

      render(<AccountMenu model={model} cropModel={cropModel} />)
      await findTrigger()
      pick(new File(['webp'], 'me.webp', { type: 'image/webp' }))
      const crop = await screen.findByTestId('avatar-crop-dialog')
      fireEvent.click(await within(crop).findByTestId('avatar-crop-save'))

      expect(await within(crop).findByTestId('avatar-crop-error')).toHaveTextContent(
        'Не получилось прочитать файл. Выберите фото в JPEG, PNG или WebP.',
      )
      expect(screen.queryByTestId('account-avatar-error')).toBeNull()
    })
  })
})
