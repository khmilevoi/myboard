import type { WidgetApi } from '@shared/widgets/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { WidgetApiError } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { makePassportCheckModel } from '../model/check-model'
import { makeRecoveryFlow } from '../model/recovery-flow'
import { makeRecoveryModel } from '../model/recovery-model'
import {
  RecoveryIssueError,
  type RecoveryIssue,
  type RecoveryTransport,
} from '../model/recovery-transport'
import type { RfbLike } from '../model/rfb'
import type { PassportCheckerEvents } from '../types'
import { passportCheckerContext } from './passport-checker-context'
import { formatAccessCountdown, RecoveryModal } from './RecoveryModal'

class FakeRfb implements RfbLike {
  listeners = new Map<string, Set<(event: Event) => void>>()
  disconnectCalls = 0

  constructor(public url: string) {}

  addEventListener(type: string, listener: (event: Event) => void) {
    const set = this.listeners.get(type) ?? new Set()
    set.add(listener)
    this.listeners.set(type, set)
  }

  removeEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.get(type)?.delete(listener)
  }

  disconnect() {
    this.disconnectCalls += 1
  }

  emit(type: string) {
    // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot listeners before invoking them so a handler that (un)registers a listener mid-emit can't mutate the set we're iterating.
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type))
  }
}

function setup(
  issueResults: Array<RecoveryIssueError | RecoveryIssue>,
  sshTarget: string | null = 'admin@pi',
  novncPort = 6080,
) {
  const invoke = vi.fn(
    async () => new WidgetApiError({ reason: 'x', code: 'browser_session_required' }),
  )
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
    storage: createFakeStorage(),
  })
  checkModel.transient.set({ kind: 'sessionRequired', sshTarget, novncPort })
  checkModel.recoveryOpen.set(true)

  const issueCalls: string[] = []
  const results = [...issueResults]
  const transport: RecoveryTransport = {
    issue: async (widgetId) => {
      issueCalls.push(widgetId)
      const next = results.shift()
      if (!next) return new RecoveryIssueError({ code: 'automation_unavailable' })
      return next
    },
  }
  const rfbs: FakeRfb[] = []
  const recoveryModel = makeRecoveryModel({
    widgetId: 'passport-checker',
    transport,
    makeRfb: (_target, url) => {
      const rfb = new FakeRfb(url)
      rfbs.push(rfb)
      return rfb
    },
    location: { protocol: 'https:', host: 'board.test' },
  })

  const recoveryFlow = makeRecoveryFlow({ checkModel, recoveryModel })

  const view = render(
    <passportCheckerContext.Provider value={{ checkModel, recoveryModel, recoveryFlow }}>
      <RecoveryModal restoreFullscreen={vi.fn()} />
    </passportCheckerContext.Provider>,
  )

  return { ...view, checkModel, recoveryModel, invoke, issueCalls, rfbs }
}

describe('formatAccessCountdown', () => {
  it('formats M:SS', () => {
    expect(formatAccessCountdown(60_000)).toBe('1:00')
    expect(formatAccessCountdown(59_000)).toBe('0:59')
    expect(formatAccessCountdown(0)).toBe('0:00')
    expect(formatAccessCountdown(-500)).toBe('0:00')
  })
})

describe('RecoveryModal', () => {
  it('opens as a dialog, issues a capability and goes live on connect', async () => {
    const { issueCalls, rfbs } = setup([{ expiresInMs: 60_000 }])

    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByText('Восстановление сессии браузера')).toBeInTheDocument()
    expect(issueCalls).toEqual(['passport-checker'])

    await screen.findByText(/доступ · 1:00/)
    rfbs[0]?.emit('connect')
    expect(await screen.findByText(/LIVE · 1280×720/)).toBeInTheDocument()
  })

  it('moves focus into the dialog on open', async () => {
    setup([{ expiresInMs: 60_000 }])

    const dialog = await screen.findByRole('dialog')
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes and tears down on Escape', async () => {
    const { checkModel, rfbs } = setup([{ expiresInMs: 60_000 }])
    await screen.findByRole('dialog')
    await screen.findByText(/доступ · 1:00/)

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(rfbs[0]?.disconnectCalls).toBe(1)
  })

  it('closes on backdrop pointerdown but not inside the dialog', async () => {
    const { checkModel } = setup([{ expiresInMs: 60_000 }])
    const dialog = await screen.findByRole('dialog')

    fireEvent.pointerDown(dialog)
    expect(checkModel.recoveryOpen()).toBe(true)

    const overlay = dialog.parentElement
    if (!overlay) throw new Error('expected the overlay element')
    fireEvent.pointerDown(overlay)
    expect(checkModel.recoveryOpen()).toBe(false)
  })

  it('retries the check from the footer: teardown, close, re-invoke', async () => {
    const { checkModel, invoke, rfbs } = setup([{ expiresInMs: 60_000 }])
    await screen.findByText(/доступ · 1:00/)

    fireEvent.click(screen.getByRole('button', { name: /Повторить проверку/ }))

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(rfbs[0]?.disconnectCalls).toBe(1)
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1))
  })

  it('reconnect after a disconnect re-issues a fresh capability', async () => {
    const { issueCalls, rfbs } = setup([{ expiresInMs: 60_000 }, { expiresInMs: 60_000 }])
    await screen.findByText(/доступ · 1:00/)

    rfbs[0]?.emit('disconnect')
    expect(await screen.findByText('Соединение разорвано')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Переподключиться' }))
    await screen.findByText(/доступ · 1:00/)
    expect(issueCalls).toHaveLength(2)
    expect(rfbs).toHaveLength(2)
  })

  it.each([
    [
      new RecoveryIssueError({ code: 'recovery_unavailable' }),
      'Нет активной сессии для восстановления',
    ],
    [new RecoveryIssueError({ code: 'recovery_busy' }), 'Восстановление уже идёт'],
    [new RecoveryIssueError({ code: 'automation_unavailable' }), 'Сервис автоматизации недоступен'],
  ])('renders the issue-error frame: %s', async (error, copy) => {
    setup([error])

    expect(await screen.findByText(copy)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Переподключиться' })).toBeInTheDocument()
  })

  it('shows the SSH fallback with the real command, using the stack default noVNC port', async () => {
    setup([{ expiresInMs: 60_000 }])
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: /Запасной вход по SSH/ }))

    expect(screen.getByText('ssh -L 6080:127.0.0.1:6080 admin@pi')).toBeInTheDocument()
    expect(screen.getByText(/http:\/\/localhost:6080/)).toBeInTheDocument()
    expect(
      screen.getByText('ssh-цель из конфигурации виджета · тот же одноразовый срок доступа'),
    ).toBeInTheDocument()
  })

  // A dev or branch stack publishes noVNC on a different host port (see
  // docker-compose.yml's NOVNC_HOST_PORT); the SSH tunnel and hint must
  // follow that stack's actual port, not the production default, or an
  // operator recovering one stack tunnels into a different one's Chromium.
  it('shows the SSH fallback with a non-default noVNC port', async () => {
    setup([{ expiresInMs: 60_000 }], 'admin@pi', 6180)
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: /Запасной вход по SSH/ }))

    expect(screen.getByText('ssh -L 6180:127.0.0.1:6180 admin@pi')).toBeInTheDocument()
    expect(screen.getByText(/http:\/\/localhost:6180/)).toBeInTheDocument()
  })

  it('hides the SSH section when sshTarget is null', async () => {
    setup([{ expiresInMs: 60_000 }], null)
    await screen.findByRole('dialog')

    expect(screen.queryByRole('button', { name: /Запасной вход по SSH/ })).toBeNull()
  })

  it('cycles Tab within the dialog', async () => {
    setup([{ expiresInMs: 60_000 }])
    const dialog = await screen.findByRole('dialog')

    const buttons = dialog.querySelectorAll('button')
    const last = buttons[buttons.length - 1]
    if (!(last instanceof HTMLElement)) throw new Error('expected a focusable footer button')
    last.focus()

    fireEvent.keyDown(document, { key: 'Tab' })
    expect(dialog.contains(document.activeElement)).toBe(true)
    expect(document.activeElement).not.toBe(last)
  })
})

describe('RecoveryModal focus containment', () => {
  it('pulls focus back when something outside steals it', async () => {
    setup([{ expiresInMs: 60_000 }])
    const dialog = await screen.findByRole('dialog')

    const outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.append(outside)
    outside.focus()

    expect(dialog.contains(document.activeElement)).toBe(true)
    outside.remove()
  })

  it('leaves focus alone once the modal is gone', async () => {
    // A behavioral assert alone (activeElement stays on `outside` after
    // unmount) can't distinguish "the containment listener was removed"
    // from "the listener leaked but is now a no-op on the detached dialog
    // tree" — both leave `outside` focused in jsdom. Pin the actual cleanup
    // contract directly: the exact `focusin` listener `useModalIsolation`
    // registers on window must be the one removed on unmount.
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')

    const view = setup([{ expiresInMs: 60_000 }])
    await screen.findByRole('dialog')

    const [, onFocusIn] =
      addSpy.mock.calls.find(([type, , options]) => type === 'focusin' && options === true) ?? []
    if (typeof onFocusIn !== 'function') throw new Error('expected a captured focusin listener')

    const outside = document.createElement('button')
    document.body.append(outside)

    view.unmount()

    expect(removeSpy).toHaveBeenCalledWith('focusin', onFocusIn, true)

    outside.focus()
    expect(document.activeElement).toBe(outside)
    outside.remove()

    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
