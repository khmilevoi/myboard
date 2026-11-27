// @vitest-environment jsdom
import { context } from '@reatom/core'
import type { HardwareSnapshot } from '@shared/hardware/board-api'
import { CONSENT_CODE_DIGITS } from '@shared/hardware/spike-assumptions'
import type { ScriptedStep } from '@shared/http/test/scripted-http'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  makeGateway,
  makeHardware,
  makeSnapshot,
  makeTestHardwareModel,
  TEST_ADDRESS,
  TEST_NOW,
} from '../model/testing'
import { HardwareList } from './HardwareList'

// Reset BEFORE each test, like the account menu tests: an after-reset races the unmount cleanup.
beforeEach(() => context.reset())

const HOUR = 3_600_000
const MIN = 60_000
const MORNING = new Date(2026, 10, 27, 8, 12).getTime()
const YESTERDAY = new Date(2026, 10, 26, 21, 40).getTime()
const GENERIC_ERROR = 'Не получилось. Попробуйте ещё раз.'

const mine = (index: number) => ({ index, binding: 'mine' as const })
const other = (index: number) => ({ index, binding: 'other' as const })

async function renderList(snapshot: HardwareSnapshot, script: Record<string, ScriptedStep[]> = {}) {
  const env = makeTestHardwareModel(snapshot, script)
  const callbacks = {
    onAddGateway: vi.fn(),
    onAddHardware: vi.fn(),
    onConnectProfile: vi.fn(),
  }
  render(<HardwareList model={env.model} {...callbacks} />)
  await screen.findByTestId('hardware-list')
  await waitFor(() => expect(screen.queryByText('Загружаем…')).toBeNull())
  const deletes = () => env.calls.filter((call) => call.method === 'DELETE')
  return { ...env, ...callbacks, deletes }
}

const standard = () =>
  makeSnapshot(
    [makeGateway()],
    [makeHardware({ lastReadingAt: MORNING, profiles: [mine(1), other(2)] })],
  )

describe('HardwareList frames (§2)', () => {
  it('(a) nothing connected: «Сначала нужен шлюз» and «Добавить шлюз»', async () => {
    const env = await renderList(makeSnapshot())

    expect(screen.getByText('Сначала нужен шлюз')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Добавить шлюз' }))
    expect(env.onAddGateway).toHaveBeenCalledTimes(1)
  })

  it('(b) gateway and scale on line, own profile with its buttons, other account without', async () => {
    await renderList(standard())

    const gateway = screen.getByTestId('hardware-gateway-g1')
    expect(within(gateway).getByText('Raspberry Pi')).toBeInTheDocument()
    expect(within(gateway).getByText('в сети')).toBeInTheDocument()
    const scale = screen.getByTestId('hardware-scale-h1')
    expect(within(scale).getByText('Beurer BF 950')).toBeInTheDocument()
    expect(within(scale).getByText('батарея 80% · взвешивание сегодня, 08:12')).toBeInTheDocument()

    const own = screen.getByTestId('hardware-profile-h1-1')
    expect(own).toHaveTextContent('Профиль 1 · ваш')
    expect(within(own).getByRole('button', { name: 'Код согласия' })).toBeEnabled()
    expect(within(own).getByRole('button', { name: 'Отвязать' })).toBeEnabled()

    const foreign = screen.getByTestId('hardware-profile-h1-2')
    expect(foreign).toHaveTextContent('Профиль 2 · другой аккаунт')
    expect(within(foreign).queryByRole('button')).toBeNull()

    expect(within(scale).getByRole('button', { name: 'Отключить' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить оборудование' })).toBeEnabled()
  })

  it("Review Focus 4: another account's profiles have no «Код согласия» and no «Отвязать»", async () => {
    const env = await renderList(
      makeSnapshot([makeGateway()], [makeHardware({ profiles: [other(1), other(2)] })]),
    )

    expect(screen.getByTestId('hardware-profile-h1-1')).toHaveTextContent('другой аккаунт')
    expect(screen.queryByRole('button', { name: 'Код согласия' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Отвязать' })).toBeNull()
    // The «no profile of yours» row offers connecting one.
    fireEvent.click(screen.getByRole('button', { name: 'Подключить профиль' }))
    expect(env.onConnectProfile).toHaveBeenCalledWith('h1')
  })

  it('(b2) battery under 20% shows the warning row', async () => {
    await renderList(
      makeSnapshot(
        [makeGateway()],
        [makeHardware({ battery: 14, lastReadingAt: MORNING, profiles: [mine(1)] })],
      ),
    )

    const scale = screen.getByTestId('hardware-scale-h1')
    expect(within(scale).getByText('батарея 14%')).toBeInTheDocument()
    expect(within(scale).getByRole('note')).toHaveTextContent('Батарея весов садится.')
  })

  it('(c) scale without the account’s profile: «Ваших взвешиваний с этих весов нет» + «Подключить профиль»', async () => {
    await renderList(
      makeSnapshot(
        [makeGateway()],
        [makeHardware({ lastReadingAt: YESTERDAY, profiles: [other(1)] })],
      ),
    )

    expect(screen.getByText('Ваших взвешиваний с этих весов нет')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Подключить профиль' })).toBeEnabled()
    expect(screen.getByText('батарея 80% · взвешивание вчера, 21:40')).toBeInTheDocument()
  })

  it('(d) gateway offline: note, no «Отключить», «Добавить оборудование» disabled with its hint, code and unbind still work', async () => {
    await renderList(
      makeSnapshot(
        [makeGateway({ online: false, lastSeenAt: TEST_NOW - 3 * HOUR })],
        [makeHardware({ lastReadingAt: MORNING, profiles: [mine(1)] })],
      ),
    )

    expect(screen.getByText('не в сети')).toBeInTheDocument()
    expect(screen.getByText(/был на связи 3 ч назад/)).toBeInTheDocument()
    expect(screen.getByTestId('hardware-offline-note')).toHaveTextContent(
      'Проверьте, что Raspberry Pi включён',
    )
    expect(screen.queryByRole('button', { name: 'Отключить' })).toBeNull()
    const primary = screen.getByRole('button', { name: 'Добавить оборудование' })
    expect(primary).toBeDisabled()
    expect(primary).toHaveAccessibleDescription(
      /Добавлять оборудование и отключать весы можно, когда шлюз в сети/,
    )
    expect(screen.getByRole('button', { name: 'Код согласия' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Отвязать' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Отозвать' })).toBeEnabled()
  })

  it('(e) bonded on the gateway but not on this board: «Уже сопряжено с …», «Добавить», note, no primary', async () => {
    const env = await renderList(
      makeSnapshot(
        [
          makeGateway({
            connectedAt: TEST_NOW - 2 * MIN,
            bondedNotAdopted: [{ address: TEST_ADDRESS, model: 'beurer-bf950' }],
          }),
        ],
        [],
      ),
      {
        '/api/hardware/gateways/g1/adopt': [{ status: 200, body: { hardwareId: 'h1' } }],
      },
    )

    expect(screen.getByText('Уже сопряжено с Raspberry Pi')).toBeInTheDocument()
    expect(screen.getByText(/подключён 2 мин назад/)).toBeInTheDocument()
    expect(screen.getByText(/Сопрягать заново не нужно/)).toBeInTheDocument()
    expect(screen.queryByTestId('hardware-primary')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Добавить' }))
    await waitFor(() =>
      expect(env.calls.some((call) => call.url === '/api/hardware/gateways/g1/adopt')).toBe(true),
    )
  })

  it('(e2) gateway revoked, scale stays: note, «Ждут шлюз», «без шлюза», «Убрать», primary «Добавить шлюз»', async () => {
    await renderList(
      makeSnapshot(
        [],
        [
          makeHardware({
            gatewayId: null,
            lastReadingAt: YESTERDAY,
            profiles: [mine(1), other(2)],
          }),
        ],
      ),
    )

    expect(screen.getByText(/Шлюза сейчас нет/)).toBeInTheDocument()
    expect(screen.getByText('Ждут шлюз')).toBeInTheDocument()
    expect(screen.getByText('без шлюза')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Убрать' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Код согласия' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Добавить шлюз' })).toBeEnabled()
  })

  it('(e3) the same gateway came back: «Уже были на этой борде», «Вернуть», note', async () => {
    const env = await renderList(
      makeSnapshot(
        [
          makeGateway({
            connectedAt: TEST_NOW,
            bondedNotAdopted: [{ address: TEST_ADDRESS, model: 'beurer-bf950' }],
          }),
        ],
        [makeHardware({ gatewayId: null, profiles: [mine(1), other(2)] })],
      ),
      { '/api/hardware/gateways/g1/adopt': [{ status: 200, body: { hardwareId: 'h1' } }] },
    )

    expect(screen.getByText('Уже были на этой борде')).toBeInTheDocument()
    expect(screen.getByText(/Raspberry Pi помнит эти весы/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Код согласия' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Вернуть' }))
    await waitFor(() =>
      expect(
        env.calls.find((call) => call.url === '/api/hardware/gateways/g1/adopt')?.json,
      ).toEqual({ address: TEST_ADDRESS }),
    )
  })
})

describe('HardwareList inline confirms (§5)', () => {
  it('«Отозвать» asks first, and confirming revokes the gateway', async () => {
    const env = await renderList(standard(), {
      '/api/hardware/gateways/g1': [{ status: 204 }],
    })

    fireEvent.click(
      within(screen.getByTestId('hardware-gateway-g1')).getByRole('button', { name: 'Отозвать' }),
    )

    const confirm = await screen.findByTestId('hardware-confirm')
    expect(confirm).toHaveTextContent('Отозвать шлюз? Raspberry Pi перестанет связываться')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отозвать' }))

    await waitFor(() =>
      expect(env.deletes().map((call) => call.url)).toEqual(['/api/hardware/gateways/g1']),
    )
    await waitFor(() => expect(screen.queryByTestId('hardware-confirm')).toBeNull())
  })

  it('«Отключить» shows the §5(c) text and unpairs the scale', async () => {
    const env = await renderList(standard(), { '/api/hardware/items/h1': [{ status: 204 }] })

    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }))

    const confirm = await screen.findByTestId('hardware-confirm')
    expect(confirm).toHaveTextContent(
      'Отключить Beurer BF 950? Сопряжение разорвётся, профили отвяжутся у всех участников.',
    )
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отключить' }))

    await waitFor(() =>
      expect(env.deletes().map((call) => call.url)).toEqual(['/api/hardware/items/h1']),
    )
  })

  it('«Отвязать» shows the §5(b) text with the profile number and unbinds it', async () => {
    const env = await renderList(standard(), {
      '/api/hardware/items/h1/profiles/1': [{ status: 204 }],
    })

    fireEvent.click(
      within(screen.getByTestId('hardware-profile-h1-1')).getByRole('button', { name: 'Отвязать' }),
    )

    const confirm = await screen.findByTestId('hardware-confirm')
    expect(confirm).toHaveTextContent('Отвязать профиль 1? Новые взвешивания перестанут приходить')
    fireEvent.click(within(confirm).getByRole('button', { name: 'Отвязать' }))

    await waitFor(() =>
      expect(env.deletes().map((call) => call.url)).toEqual(['/api/hardware/items/h1/profiles/1']),
    )
  })

  it('«Убрать» shows the §5(e) text and removes the detached scale', async () => {
    const env = await renderList(
      makeSnapshot([], [makeHardware({ gatewayId: null, profiles: [mine(1)] })]),
      { '/api/hardware/items/h1': [{ status: 204 }] },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Убрать' }))

    const confirm = await screen.findByTestId('hardware-confirm')
    expect(confirm).toHaveTextContent(
      'Убрать Beurer BF 950 с борды? Профили отвяжутся у всех участников',
    )
    fireEvent.click(within(confirm).getByRole('button', { name: 'Убрать' }))

    await waitFor(() =>
      expect(env.deletes().map((call) => call.url)).toEqual(['/api/hardware/items/h1']),
    )
  })

  it('«Отмена» closes the confirm without a request', async () => {
    const env = await renderList(standard())

    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Отмена' }))

    await waitFor(() => expect(screen.queryByTestId('hardware-confirm')).toBeNull())
    expect(screen.getByRole('button', { name: 'Отключить' })).toBeInTheDocument()
    expect(env.deletes()).toEqual([])
  })

  it('the confirm is disabled while its request runs, so a second click cannot double-submit', async () => {
    let finish: () => void = () => {}
    const unpair = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const env = makeTestHardwareModel(standard(), {}, { unpair })
    render(
      <HardwareList
        model={env.model}
        onAddGateway={vi.fn()}
        onAddHardware={vi.fn()}
        onConnectProfile={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Отключить' }))
    fireEvent.click(await screen.findByTestId('hardware-confirm-ok'))

    await waitFor(() => expect(screen.getByTestId('hardware-confirm-ok')).toBeDisabled())
    expect(screen.getByTestId('hardware-confirm-cancel')).toBeDisabled()
    fireEvent.click(screen.getByTestId('hardware-confirm-ok'))
    expect(unpair).toHaveBeenCalledTimes(1)

    finish()
    await waitFor(() => expect(screen.queryByTestId('hardware-confirm')).toBeNull())
  })

  it('while a confirm request runs, the other rows’ triggers are disabled', async () => {
    let finish: () => void = () => {}
    const unpair = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    const env = makeTestHardwareModel(standard(), {}, { unpair })
    render(
      <HardwareList
        model={env.model}
        onAddGateway={vi.fn()}
        onAddHardware={vi.fn()}
        onConnectProfile={vi.fn()}
      />,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Отключить' }))
    fireEvent.click(await screen.findByTestId('hardware-confirm-ok'))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Отозвать' })).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Код согласия' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Отвязать' })).toBeDisabled()

    finish()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Отозвать' })).toBeEnabled())
  })

  it('actionError is shown under the confirm and the confirm stays open', async () => {
    await renderList(standard(), { '/api/hardware/items/h1': [{ status: 500 }] })

    fireEvent.click(screen.getByRole('button', { name: 'Отключить' }))
    fireEvent.click(await screen.findByTestId('hardware-confirm-ok'))

    const error = await within(screen.getByTestId('hardware-confirm')).findByRole('alert')
    expect(error).toHaveTextContent(GENERIC_ERROR)
    expect(screen.getByTestId('hardware-confirm-ok')).toBeEnabled()
  })
})

describe('HardwareList consent code reveal (§5(a))', () => {
  const code = '7'.repeat(CONSENT_CODE_DIGITS)

  it('«Код согласия» shows the code, «Скрыть» and the privacy hint; «Скрыть» hides it', async () => {
    await renderList(standard(), {
      '/api/hardware/items/h1/profiles/1/consent-code': [
        { status: 200, body: { consentCode: code } },
      ],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Код согласия' }))

    expect(await screen.findByTestId('hardware-code')).toHaveTextContent(code)
    expect(
      screen.getByText('Код видите только вы. Другие участники борды его не получают.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Код согласия' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Скрыть' }))

    await waitFor(() => expect(screen.queryByTestId('hardware-code')).toBeNull())
    expect(screen.queryByText(/Код видите только вы/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Код согласия' })).toBeInTheDocument()
  })

  it('a failed reveal shows the error banner', async () => {
    await renderList(standard(), {
      '/api/hardware/items/h1/profiles/1/consent-code': [{ status: 500 }],
    })

    fireEvent.click(screen.getByRole('button', { name: 'Код согласия' }))

    expect(await screen.findByTestId('hardware-action-error')).toHaveTextContent(GENERIC_ERROR)
  })
})
