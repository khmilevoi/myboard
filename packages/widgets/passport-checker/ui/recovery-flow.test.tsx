import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import {
  makeHostRuntime,
  makeStaticWidgetIdentity,
  resetOverlayHistory,
  WidgetApiError,
  WidgetRuntimeContext,
} from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'

import { PassportChecker } from './PassportChecker'

// Root-caused (task-4-report.md, Fix round 3; extended to the first test in
// this file in Task 5 fix round 1): a test that opens the modal and then
// closes it with Escape can hang for the full test budget.
// `findByRole('dialog')` resolves as soon as the dialog's DOM node commits,
// but `useModalIsolation`'s mount effect — which attaches the Escape
// listener — is a passive effect that can still be pending a tick later.
// Firing Escape into that gap dispatches into a document with no listener
// yet, so the dialog never closes and the `waitFor` below spins until it
// times out.
//
// Scope of the measurement: "roughly 1 in 15-40 runs, reproducing solo with
// no whole-suite contention required" was measured for exactly ONE test —
// 'does not collapse when recovery opens from the tile'. No failure rate was
// ever measured for the other Escape-closing tests here; they carry the same
// wait because they have the identical shape and reach the identical race,
// which is reasoning by inspection, not an observed frequency.
//
// Each Escape-closing test now waits for that effect's other, synchronous
// side effect (moving focus into the dialog) before dispatching Escape, which
// proves the same effect has also run and attached the listener.
// `ROUND_TRIP_TIMEOUT_MS` stays as a modest safety margin for "does not
// collapse when recovery opens from the tile" below under ordinary
// whole-suite worker contention. Every other test in this file keeps the
// shared default instead — none of the fullscreen-inline-recovery tests fire
// Escape at all, so they would still fail fast if they ever regressed.
const ROUND_TRIP_TIMEOUT_MS = 10_000

function renderSessionRequired() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<never>(() => {})),
  )
  const invoke = vi.fn(
    async () =>
      new WidgetApiError({
        reason: 'x',
        code: 'browser_session_required',
        meta: { sshTarget: 'admin@pi' },
      }),
  )
  const props: WidgetRuntimeProps = {
    instanceId: 'inst-passport',
    typeId: 'passport-checker',
    mode: 'small',
    tier: 'standard',
    theme: 'light',
    requestFullscreen: vi.fn(),
    requestClose: vi.fn(),
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({
      instanceId: 'inst-passport',
      typeId: 'passport-checker',
    }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
    identity: makeStaticWidgetIdentity(),
  }
  return render(
    <WidgetRuntimeContext.Provider value={props}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
}

beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recovery flow from the tile', () => {
  it('opens the modal from sessionRequired, closes on Esc and returns focus', async () => {
    renderSessionRequired()

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    const openButton = await screen.findByRole('button', { name: /Открыть восстановление/ })

    // jsdom's fireEvent.click does not focus the target the way a real
    // browser does — focus explicitly so the focus-return assertion is real.
    openButton.focus()
    fireEvent.click(openButton)
    const dialog = await screen.findByRole('dialog')
    // See the file-level comment: findByRole resolves on DOM commit alone,
    // but useModalIsolation's mount effect (which attaches the Escape
    // listener and moves focus in) is passive and can still be pending a
    // tick later. Wait for the synchronous side effect of that same effect
    // — focus landing inside the dialog — before dispatching Escape below.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    fireEvent.keyDown(document, { key: 'Escape' })
    // Reatom flushes subscribers on a microtask, so the unmount (and the
    // focus-return cleanup) land after the synchronous event — await them.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(openButton))
  })
})

// The model graph is module-scoped and keyed by instanceId (Task 3), and
// Reatom's disposal is a microtask — so each call below needs its own id, or
// a live model from one test (recoveryOpen still true) leaks into the next.
// The id must match between the props and the storage below.
function renderSessionRequiredIn(tier: WidgetRuntimeProps['tier'], instanceId: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<never>(() => {})),
  )
  const invoke = vi.fn(
    async () =>
      new WidgetApiError({
        reason: 'x',
        code: 'browser_session_required',
        meta: { sshTarget: 'admin@pi' },
      }),
  )
  const requestClose = vi.fn()
  const requestFullscreen = vi.fn()
  const props: WidgetRuntimeProps = {
    instanceId,
    typeId: 'passport-checker',
    mode: 'large',
    tier,
    theme: 'light',
    requestFullscreen,
    requestClose,
    requestDelete: vi.fn(),
    reportError: vi.fn(),
    storage: makeHostRuntime().makeWidgetStorage({
      instanceId,
      typeId: 'passport-checker',
    }),
    api: { invoke: invoke as WidgetRuntimeProps['api']['invoke'] },
    identity: makeStaticWidgetIdentity(),
  }
  const view = render(
    <WidgetRuntimeContext.Provider value={props}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
  return { view, requestClose, requestFullscreen }
}

describe('recovery flow across tiers', () => {
  it('opens recovery inline in fullscreen instead of collapsing to the tile modal', async () => {
    const { requestClose } = renderSessionRequiredIn('fullscreen', 'inst-passport-tier-fullscreen')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))

    // The embedded recovery section renders in place — no portal dialog, and
    // the fullscreen mount never asks the host to close it.
    expect(await screen.findByRole('button', { name: /Повторить проверку/ })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(requestClose).not.toHaveBeenCalled()
  })

  it('returns to the trigger card when inline recovery is closed, without touching fullscreen', async () => {
    const { requestClose, requestFullscreen } = renderSessionRequiredIn(
      'fullscreen',
      'inst-passport-tier-fullscreen-close',
    )

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
    await screen.findByRole('button', { name: /Повторить проверку/ })

    // Two buttons share the accessible name "Закрыть" here: the widget's own
    // header close (mode="large" chrome, always present) and the recovery
    // footer's — the last one rendered is the footer's, same disambiguation
    // the RecoveryModal tests below already rely on for its header/footer pair.
    const closeButtons = screen.getAllByRole('button', { name: 'Закрыть' })
    fireEvent.click(closeButtons[closeButtons.length - 1])

    expect(
      await screen.findByRole('button', { name: /Открыть восстановление/ }),
    ).toBeInTheDocument()
    expect(requestClose).not.toHaveBeenCalled()
    expect(requestFullscreen).not.toHaveBeenCalled()
  })

  it(
    'does not collapse when recovery opens from the tile',
    async () => {
      const { requestClose, requestFullscreen } = renderSessionRequiredIn(
        'standard',
        'inst-passport-tier-standard',
      )

      fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
      fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
      const dialog = await screen.findByRole('dialog')
      // The dialog's DOM node lands on the same commit as useModalIsolation's
      // mount effect, but that effect (which both moves focus in AND attaches
      // the Escape listener) is passive and can still be pending a tick after
      // findByRole resolves on the DOM node alone. Waiting for its other,
      // synchronous side effect — focus landing inside the dialog — proves
      // the same effect has also attached the listener Escape needs below;
      // without this, Escape can fire into a dialog that cannot yet hear it,
      // and the close assertion below waits out its full timeout for nothing.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

      expect(requestClose).not.toHaveBeenCalled()
      expect(requestFullscreen).not.toHaveBeenCalled()
    },
    ROUND_TRIP_TIMEOUT_MS,
  )

  it('closes the recovery modal on the platform back gesture', async () => {
    renderSessionRequiredIn('standard', 'inst-passport-back-gesture')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
    const dialog = await screen.findByRole('dialog')

    // Same race the file-level comment above describes, for the same reason:
    // findByRole resolves on DOM commit, but the modal's passive mount effects
    // — useModalIsolation's listeners AND useOverlayBackDismiss's history push
    // — can still be pending. Focus landing inside the dialog proves they ran.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
    expect(history.state).toMatchObject({ overlayDepth: 1 })

    history.replaceState({ overlayDepth: 0 }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  // The test above drives popstate -> modal closes, which passes whether the
  // close buttons route through the hook or call `close` directly (the
  // reconciler unmounts the modal either way). This test drives the other
  // direction — the close buttons themselves — so a revert of
  // `onClick={requestDismiss}` back to `onClick={close}` is caught: with
  // `history.back` mocked to a no-op, a routed close leaves the modal
  // mounted (only the reconciler's popstate handler may unmount it), while a
  // direct `close` call would both skip `history.back` entirely and unmount
  // the modal synchronously.
  it('routes both close buttons through history instead of closing directly', async () => {
    renderSessionRequiredIn('standard', 'inst-passport-back-buttons')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    try {
      // Scoped to the dialog: `renderSessionRequiredIn` always renders at
      // `mode: 'large'`, so the widget's OWN chrome (WidgetControls, wired to
      // `requestClose`) also renders a "Закрыть" button alongside the
      // modal's two — an unscoped query would pick that one up instead.
      const [headerClose, footerClose] = within(dialog).getAllByRole('button', {
        name: 'Закрыть',
      })

      fireEvent.click(headerClose)
      expect(back).toHaveBeenCalledTimes(1)

      fireEvent.click(footerClose)
      expect(back).toHaveBeenCalledTimes(2)

      expect(screen.getByRole('dialog')).toBeInTheDocument()
    } finally {
      back.mockRestore()
    }
  })
})
