import { context } from '@reatom/core'
import { makeScriptedHttp, type ScriptedStep } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createAccountModel } from '../model/account-model'
import type { AccountDto, DeviceDto } from '../model/devices-http'
import { ProfileDialog } from './ProfileDialog'

// Reset BEFORE each test -- AccountMenu.test.tsx's documented convention for reatomMemo trees.
beforeEach(() => context.reset())

const AVATAR_URL = '/files/AvatarAvatarAvatar01'
// Local midnight, so the formatted date never shifts with the test machine's zone.
const CREATED_AT = new Date(2026, 5, 12).getTime()

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

const account: AccountDto = {
  id: 'acc-1',
  name: 'Анна Ковалёва',
  deviceLimit: 10,
  createdAt: CREATED_AT,
}

async function renderProfile(
  options: {
    account?: AccountDto
    devices?: DeviceDto[]
    accountSteps?: ScriptedStep[]
    avatarSteps?: ScriptedStep[]
  } = {},
) {
  const body = options.account ?? account
  const devices = options.devices ?? [device({ credentialId: 'c1' })]
  const accountSteps = options.accountSteps ?? [{ status: 200, body }]
  const { http, calls } = makeScriptedHttp({
    '/api/auth/account': accountSteps,
    '/api/auth/devices': accountSteps.map(() => ({
      status: 200,
      body: { devices, thisCredentialId: 'c1' },
    })),
    '/api/files/account/avatar': options.avatarSteps ?? [],
  })
  const model = createAccountModel({
    http,
    storage: { get: () => null },
    refreshIdentity: vi.fn(async () => {}),
  })
  await model.refresh()
  const onPickPhoto = vi.fn()
  const onOpenDevices = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <ProfileDialog
      model={model}
      open
      onOpenChange={onOpenChange}
      onPickPhoto={onPickPhoto}
      onOpenDevices={onOpenDevices}
    >
      <div data-testid="nested-child" />
    </ProfileDialog>,
  )
  const dialog = await screen.findByTestId('profile-dialog')
  return { model, calls, dialog, onPickPhoto, onOpenDevices, onOpenChange }
}

describe('ProfileDialog', () => {
  it('(i) with a photo: the 88 px photo, name, join date, change and remove', async () => {
    const { dialog, onPickPhoto } = await renderProfile({
      account: { ...account, avatarUrl: AVATAR_URL },
      devices: [
        device({ credentialId: 'c1' }),
        device({ credentialId: 'c2' }),
        device({ credentialId: 'c3' }),
        device({ credentialId: 'c4', status: 'pending' }),
      ],
    })

    expect(within(dialog).getByRole('heading', { name: 'Профиль' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
    expect(within(dialog).getByTestId('profile-avatar-image')).toHaveAttribute('src', AVATAR_URL)
    expect(within(dialog).getByText('Анна Ковалёва')).toBeInTheDocument()
    expect(within(dialog).getByText('В myboard с 12 июня 2026')).toBeInTheDocument()
    expect(within(dialog).getByTestId('profile-change-photo')).toHaveTextContent('Сменить фото')
    expect(within(dialog).getByTestId('profile-remove-photo')).toHaveTextContent('Удалить')
    expect(within(dialog).queryByTestId('profile-upload-photo')).toBeNull()
    // Only active devices count against the limit.
    expect(within(dialog).getByTestId('profile-device-summary')).toHaveTextContent(
      '3 устройства из 10',
    )
    expect(within(dialog).getByText('Вход по ключу доступа')).toBeInTheDocument()

    fireEvent.click(within(dialog).getByTestId('profile-change-photo'))
    expect(onPickPhoto).toHaveBeenCalledTimes(1)
  })

  it('(j) without a photo: initials and a primary upload button', async () => {
    const { dialog, onPickPhoto } = await renderProfile()

    expect(within(dialog).queryByTestId('profile-avatar-image')).toBeNull()
    expect(within(dialog).getByText('АК')).toBeInTheDocument()
    expect(within(dialog).queryByTestId('profile-remove-photo')).toBeNull()
    expect(within(dialog).getByTestId('profile-device-summary')).toHaveTextContent(
      '1 устройство из 10',
    )

    fireEvent.click(within(dialog).getByRole('button', { name: 'Загрузить фото' }))
    expect(onPickPhoto).toHaveBeenCalledTimes(1)
  })

  it('leaves the join date out for an account without createdAt', async () => {
    const { createdAt: _createdAt, ...older } = account
    const { dialog } = await renderProfile({ account: older })
    expect(within(dialog).queryByText(/В myboard с/)).toBeNull()
  })

  it('removes the photo and falls back to initials', async () => {
    const { dialog, calls } = await renderProfile({
      accountSteps: [
        { status: 200, body: { ...account, avatarUrl: AVATAR_URL } },
        { status: 200, body: account },
      ],
      avatarSteps: [{ status: 204 }],
    })

    fireEvent.click(within(dialog).getByTestId('profile-remove-photo'))

    await waitFor(() => expect(within(dialog).queryByTestId('profile-avatar-image')).toBeNull())
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true)
    expect(within(dialog).getByTestId('profile-upload-photo')).toBeInTheDocument()
  })

  it('shows the removal failure inline and keeps the photo', async () => {
    const { dialog } = await renderProfile({
      account: { ...account, avatarUrl: AVATAR_URL },
      avatarSteps: ['network-error'],
    })

    fireEvent.click(within(dialog).getByTestId('profile-remove-photo'))

    expect(await within(dialog).findByTestId('profile-error')).toHaveTextContent(
      'Не удалось загрузить фото. Проверьте подключение и попробуйте ещё раз.',
    )
    expect(within(dialog).getByTestId('profile-avatar-image')).toBeInTheDocument()
  })

  it('hands over to the devices dialog and renders its nested child', async () => {
    const { dialog, onOpenDevices } = await renderProfile()

    expect(within(dialog).getByTestId('nested-child')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Мои устройства' }))
    expect(onOpenDevices).toHaveBeenCalledTimes(1)
  })
})
