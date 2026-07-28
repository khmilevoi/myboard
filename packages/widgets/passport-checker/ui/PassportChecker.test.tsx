import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeStaticWidgetIdentity, WidgetApiError, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { PassportChecker } from './PassportChecker'

type InvokeResult = WidgetApiError | { status: number; send_status_msg: string }

/** Isolated in-memory storage. The real host runtime would issue HTTP requests
 *  to /api/storage from jsdom now that the widget reads shared storage. */
function makeFakeStorage(): WidgetRuntimeProps['storage'] {
  const instance = createFakeStorage()
  const shared = createFakeStorage()
  return {
    instance: { client: instance, server: instance },
    shared: { client: shared, server: shared },
  }
}

function makeProps(
  tier: WidgetRuntimeProps['tier'],
  invoke: () => Promise<InvokeResult>,
  instanceId = 'inst-passport',
  storage: WidgetRuntimeProps['storage'] = makeFakeStorage(),
  mode: WidgetRuntimeProps['mode'] = 'small',
) {
  const props: WidgetRuntimeProps = {
    instanceId,
    typeId: 'passport-checker',
    mode,
    tier,
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage,
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
    identity: makeStaticWidgetIdentity(),
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
    // A delete button (widget chrome) is expected here; only the check action
    // is meant to be absent when the widget has no server-side config.
    expect(screen.queryByRole('button', { name: 'Проверить' })).toBeNull()
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

  it('offers a close control, and no delete, on the fullscreen mount', () => {
    const widgetProps = makeProps(
      'fullscreen',
      vi.fn(),
      'inst-passport-fullscreen',
      makeFakeStorage(),
      'large',
    )
    render(
      <WidgetRuntimeContext.Provider value={widgetProps}>
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    expect(screen.queryByRole('button', { name: 'Удалить' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Развернуть' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(widgetProps.requestClose).toHaveBeenCalledOnce()
  })
})

describe('PassportChecker / delete control', () => {
  it('renders in the standard tier and invokes requestDelete exactly once when clicked', () => {
    const props = makeProps('standard', vi.fn())
    render(
      <WidgetRuntimeContext.Provider value={props}>
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Удалить' }))

    expect(props.requestDelete).toHaveBeenCalledTimes(1)
  })

  it('renders in the tiny tier', () => {
    renderWidget('compact', vi.fn())

    expect(screen.getByRole('button', { name: 'Удалить' })).toBeInTheDocument()
  })

  // The board tile always mounts with mode="small"; the fullscreen overlay
  // always mounts with mode="large" (see FullscreenOverlay.tsx), so this is
  // the actual production condition under which the fullscreen mount runs —
  // not just its tier="fullscreen" in isolation.
  it('is absent from the fullscreen mount (mode="large")', () => {
    const props = makeProps('fullscreen', vi.fn(), 'inst-passport', makeFakeStorage(), 'large')
    render(
      <WidgetRuntimeContext.Provider value={props}>
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    expect(screen.queryByRole('button', { name: 'Удалить' })).toBeNull()
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

  it('renders the compact success state with a status chip and timestamp', async () => {
    renderWidget('compact', async () => ({ status: 200, send_status_msg: 'Готово' }))

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(screen.getByText(/СТАТУС 200 · \d{2}:\d{2}/)).toBeInTheDocument()
  })

  // The tiny tile offers no expand affordance (PassportChecker takes only
  // `onDelete` from useWidgetChrome), so if this state had no action of its own
  // it would be a dead end: a card narrower than the widget's 321px standard
  // threshold that restores a stored result on mount could never be re-checked.
  it('re-runs the check from the compact success state', async () => {
    const invoke = vi
      .fn<() => Promise<InvokeResult>>()
      .mockResolvedValueOnce({ status: 200, send_status_msg: 'Готово' })
      .mockResolvedValueOnce({ status: 404, send_status_msg: 'Дані не знайдено!' })

    renderWidget('compact', invoke)

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Проверить снова/ }))

    expect(await screen.findByText('Дані не знайдено!')).toBeInTheDocument()
    expect(screen.getByText(/СТАТУС 404 · \d{2}:\d{2}/)).toBeInTheDocument()
    expect(invoke).toHaveBeenCalledTimes(2)
  })

  it('shows a dated timestamp for a restored result, not "just now"', async () => {
    const storage = makeFakeStorage()
    // Fixed in the past, deliberately not "today": a restored result must read
    // as stale in the tiny tile too, not only in the standard one.
    await storage.shared.server.set('lastResult', {
      status: 200,
      message: 'Готово',
      checkedAt: new Date('2020-01-01T09:05:00').getTime(),
    })
    const invoke = vi.fn<() => Promise<InvokeResult>>()

    render(
      <WidgetRuntimeContext.Provider
        value={makeProps('compact', invoke, 'inst-restored-tiny', storage)}
      >
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    expect(await screen.findByText('Готово')).toBeInTheDocument()
    expect(screen.getByText(/СТАТУС 200 · \d{2}\.\d{2} \d{2}:\d{2}/)).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
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
    // A delete button (widget chrome) is expected here; only the check action
    // is meant to be absent when the widget has no server-side config.
    expect(screen.queryByRole('button', { name: 'Проверить' })).toBeNull()
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

  // Separate model graphs AND separate fake storages. In production the key is
  // type-scoped, so two placements do converge on the same stored result once
  // one of them checks — that is covered by the cross-placement test below,
  // which reuses one storage across two instance ids to isolate that axis.
  it('gives separate storages separate state', async () => {
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))
    renderPair(['standard', 'standard'], invoke, ['inst-one', 'inst-two'])

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])
    await screen.findByText('Готово')

    // Assert a positive fact about the SECOND placement rather than the
    // absence of 'Готово'. `findAllByText('Готово').toHaveLength(1)` would
    // resolve on the first snapshot with >= 1 match — the exact trap
    // documented above the 'shares one model graph' test — so it can never
    // go red even if the two storages started converging. The idle copy is
    // only visible while placement two has not observed a result, so its
    // continued presence is what would actually break if isolation failed.
    expect(screen.getAllByText('Проверка статуса паспорта')).toHaveLength(1)

    // Flush a macrotask so any deferred cross-storage fanout has a chance to
    // land before the final check, then re-query (not find*, which would
    // wait and never fail on its own).
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryAllByText('Готово')).toHaveLength(1)
  })

  it('renders a stored result on mount, without checking', async () => {
    const storage = makeFakeStorage()
    await storage.shared.server.set('lastResult', {
      status: 200,
      message: 'Документ готовий',
      checkedAt: Date.now(),
    })
    const invoke = vi.fn<() => Promise<InvokeResult>>()

    render(
      <WidgetRuntimeContext.Provider
        value={makeProps('standard', invoke, 'inst-restored', storage)}
      >
        <PassportChecker />
      </WidgetRuntimeContext.Provider>,
    )

    expect(await screen.findByText('Документ готовий')).toBeInTheDocument()
    expect(screen.getByText(/статус 200 · проверено \d{2}:\d{2}/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Проверить снова/ })).toBeInTheDocument()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('shows a check from one placement in another placement', async () => {
    const storage = makeFakeStorage()
    const invoke = vi.fn(async () => ({ status: 200, send_status_msg: 'Готово' }))

    render(
      <>
        <WidgetRuntimeContext.Provider
          value={makeProps('standard', invoke, 'inst-shared-a', storage)}
        >
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
        <WidgetRuntimeContext.Provider
          value={makeProps('standard', invoke, 'inst-shared-b', storage)}
        >
          <PassportChecker />
        </WidgetRuntimeContext.Provider>
      </>,
    )

    fireEvent.click(screen.getAllByRole('button', { name: /Проверить/ })[0])

    // Two independent model graphs, one type-scoped key: the second placement
    // learns the result through storage, not through a second check.
    await waitFor(() => expect(screen.getAllByText('Готово')).toHaveLength(2))
    expect(invoke).toHaveBeenCalledTimes(1)
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
