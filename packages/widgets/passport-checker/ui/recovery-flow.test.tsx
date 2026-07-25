import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeHostRuntime, WidgetApiError, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'

import { PassportChecker } from './PassportChecker'

// Root-caused (task-4-report.md, Fix round 3; extended to the first test in
// this file in Task 5 fix round 1): every test below that opens the modal
// and then closes it with Escape used to hang for the full test budget in
// roughly 1 in 15-40 runs, reproducing solo with no whole-suite contention
// required. `findByRole('dialog')` resolves as soon as the dialog's DOM node
// commits, but `useModalIsolation`'s mount effect — which attaches the
// Escape listener — is a passive effect that can still be pending a tick
// later. Firing Escape into that gap dispatches into a document with no
// listener yet, so the dialog never closes and the `waitFor` below spins
// until it times out. Each Escape-closing test now waits for that effect's
// other, synchronous side effect (moving focus into the dialog) before
// dispatching Escape, which proves the same effect has also run and
// attached the listener. `ROUND_TRIP_TIMEOUT_MS` stays as a modest safety
// margin for the two multi-mount tests below under ordinary whole-suite
// worker contention (the one test in this file that never reaches the
// Escape-close path — "collapses fullscreen…" — keeps the shared default
// and would still fail fast if it ever regressed).
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
  }
  return render(
    <WidgetRuntimeContext.Provider value={props}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
}

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
// a live model from one test (recoveryOpen/restorePending still true) leaks
// into the next. The id must match between the props and the storage below.
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
  }
  const view = render(
    <WidgetRuntimeContext.Provider value={props}>
      <PassportChecker />
    </WidgetRuntimeContext.Provider>,
  )
  return { view, requestClose, requestFullscreen }
}

describe('recovery flow across tiers', () => {
  it('collapses fullscreen when recovery opens from the fullscreen mount', async () => {
    const { requestClose } = renderSessionRequiredIn('fullscreen', 'inst-passport-tier-fullscreen')

    fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))

    expect(requestClose).toHaveBeenCalledTimes(1)
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

  // The flow model is module-scoped and keyed by instanceId (Task 3), so a
  // `restorePending` set by opening recovery from a fullscreen mount is
  // still visible when a later mount for the SAME instanceId (the tile,
  // after the host collapses the fullscreen overlay) renders the modal.
  // This is the only test that asserts the actual handoff: that closing the
  // modal from the tile calls the TILE's requestFullscreen, not a no-op.
  it(
    'restores fullscreen through the tile mount after recovery opened from the fullscreen mount',
    async () => {
      const instanceId = 'inst-passport-tier-handoff'
      const fullscreenMount = renderSessionRequiredIn('fullscreen', instanceId)

      fireEvent.click(screen.getByRole('button', { name: /Проверить/ }))
      fireEvent.click(await screen.findByRole('button', { name: /Открыть восстановление/ }))
      expect(fullscreenMount.requestClose).toHaveBeenCalledTimes(1)

      // Mirrors what the host does when requestClose collapses the fullscreen
      // overlay: the fullscreen mount goes away and the tile mount (same
      // instanceId, tier 'standard') takes over.
      fullscreenMount.view.unmount()

      const tileMount = renderSessionRequiredIn('standard', instanceId)
      // recoveryOpen was already true on the shared model, so the modal
      // renders immediately — no need to click through sessionRequired again.
      const dialog = await screen.findByRole('dialog')
      // See the sibling test above: wait for useModalIsolation's mount
      // effect (focus-in) so we know its Escape listener is attached too.
      await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))

      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

      expect(tileMount.requestFullscreen).toHaveBeenCalledTimes(1)
      expect(fullscreenMount.requestFullscreen).not.toHaveBeenCalled()
    },
    ROUND_TRIP_TIMEOUT_MS,
  )
})
