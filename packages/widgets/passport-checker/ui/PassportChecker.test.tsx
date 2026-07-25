import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeHostRuntime, WidgetApiError, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'

import { PassportChecker } from './PassportChecker'

type InvokeResult = WidgetApiError | { status: number; send_status_msg: string }

function makeProps(
  tier: WidgetRuntimeProps['tier'],
  invoke: () => Promise<InvokeResult>,
  instanceId = 'inst-passport',
) {
  const props: WidgetRuntimeProps = {
    instanceId,
    typeId: 'passport-checker',
    mode: 'small',
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({ instanceId, typeId: 'passport-checker' }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
  }
  return props
}

function renderWidget(tier: WidgetRuntimeProps['tier'], invoke: () => Promise<InvokeResult>) {
  return render(
    <WidgetRuntimeContext.Provider value={makeProps(tier, invoke)}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
}

function apiError(code: string, meta?: Record<string, unknown>) {
  return new WidgetApiError({ reason: `${code}: message`, code, meta })
}

describe('PassportChecker / standard tier', () => {
  it('renders the idle state', () => {
    renderWidget('standard', vi.fn())

    expect(screen.getByText('Паспорт')).toBeInTheDocument()
    expect(screen.getByText('Проверка статуса паспорта')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeEnabled()
  })

  it('disables the button and shows the pending row while checking', async () => {
    renderWidget('standard', () => new Promise<never>(() => {}))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Проверяем…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeDisabled()
  })

  it('renders success with status and local time', async () => {
    renderWidget('standard', async () => ({ status: 200, send_status_msg: 'Документ готовий' }))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Документ готовий')).toBeInTheDocument()
    expect(screen.getByText(/статус 200 · проверено \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить снова/ })).toBeInTheDocument()
  })

  it('renders a retryable error with an alert role', async () => {
    renderWidget('standard', async () => apiError('browser_unavailable'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Сервис автоматизации недоступен')
    expect(screen.getByText('Попробуйте ещё раз.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument()
  })

  it('renders invalidConfig without an action button', async () => {
    renderWidget('standard', async () => apiError('browser_configuration'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Паспорт-чекер не настроен')).toBeInTheDocument()
    expect(screen.getByText('Обратитесь к администратору.')).toBeInTheDocument()
    expect(screen.getByText('действие недоступно · нужна настройка на сервере')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders sessionRequired with the open-recovery action', async () => {
    renderWidget('standard', async () =>
      apiError('browser_session_required', { sshTarget: 'admin@pi' }),
    )

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Требуется вход в браузер')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Открыть восстановление/ })).toBeInTheDocument()
  })

  it('retries after a retryable error', async () => {
    const invoke = vi
      .fn<() => Promise<InvokeResult>>()
      .mockResolvedValueOnce(apiError('upstream_response'))
      .mockResolvedValueOnce({ status: 200, send_status_msg: 'Готово' })
    renderWidget('standard', invoke)

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Повторить/ }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledTimes(2)
  })
})

describe('PassportChecker / tiny tier', () => {
  it('renders the compact idle state', () => {
    renderWidget('compact', vi.fn())

    expect(screen.getByText('Паспорт')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeInTheDocument()
    expect(screen.queryByText('Проверка статуса паспорта')).toBeNull()
  })

  it('renders the compact pending state', async () => {
    renderWidget('compact', () => new Promise<never>(() => {}))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Проверяем…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить/ })).toBeDisabled()
  })

  it('renders the compact error state', async () => {
    renderWidget('compact', async () => apiError('upstream_response'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('ошибка')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Повторить/ })).toBeInTheDocument()
  })

  it('renders the compact success state with a status chip', async () => {
    renderWidget('compact', async () => ({ status: 200, send_status_msg: 'Готово' }))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(screen.getByText('СТАТУС 200')).toBeInTheDocument()
  })

  it('renders the compact sessionRequired state', async () => {
    renderWidget('compact', async () => apiError('browser_session_required'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Требуется вход в браузер')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Открыть' })).toBeInTheDocument()
  })

  it('renders the compact invalidConfig state without a button', async () => {
    renderWidget('compact', async () => apiError('browser_configuration'))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Не настроен')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('PassportChecker / shared instance state', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function renderPair(
    tiers: [WidgetRuntimeProps['tier'], WidgetRuntimeProps['tier']],
    invoke: () => Promise<InvokeResult>,
    ids: [string, string] = ['inst-passport', 'inst-passport'],
  ) {
    return render(
      <>
        <WidgetRuntimeContext.Provider value={makeProps(tiers[0], invoke, ids[0])}>
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
        <WidgetRuntimeContext.Provider value={makeProps(tiers[1], invoke, ids[1])}>
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
      </>,
    )
  }

  it('shares one model graph between the tile and fullscreen mounts', async () => {
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))
    renderPair(['standard', 'fullscreen'], invoke)

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])

    // One check, one result, rendered by BOTH mounts. `findAllByText` cannot
    // express this: it resolves on the first snapshot with >= 1 match, so it
    // would settle on a single mount's result and never see the second. Only
    // a re-querying `waitFor` actually retries until both have rendered.
    await waitFor(() => expect(screen.getAllByText('Готово')).toHaveLength(2))
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('gives separate instance ids separate state', async () => {
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))
    renderPair(['standard', 'standard'], invoke, ['inst-one', 'inst-two'])

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])

    expect(await screen.findAllByText('Готово')).toHaveLength(1)
  })

  it('renders the recovery modal from the tile mount, never from fullscreen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<never>(() => {})),
    )
    const invoke = vi.fn(async () =>
      apiError('browser_session_required', { sshTarget: 'admin@pi' }),
    )
    renderPair(['standard', 'fullscreen'], invoke)

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])
    // Same reason as above: `findAllByRole` resolves on the first snapshot
    // with >= 1 match, so it cannot retry its way up to two. Re-query.
    const openButtonsQuery = () => screen.getAllByRole('button', { name: /Открыть восстановление/ })
    await waitFor(() => expect(openButtonsQuery()).toHaveLength(2))

    fireEvent.click(openButtonsQuery()[0])

    // Exactly one modal, even though two mounts observe recoveryOpen.
    expect(await screen.findAllByRole('dialog')).toHaveLength(1)
  })
})
