import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeHostRuntime, WidgetApiError, WidgetRuntimeContext } from 'widget-runtime'
import type { WidgetRuntimeProps } from 'widget-runtime'

import { PassportChecker } from './PassportChecker'

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
    expect(dialog.contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(document, { key: 'Escape' })
    // Reatom flushes subscribers on a microtask, so the unmount (and the
    // focus-return cleanup) land after the synchronous event — await them.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(openButton))
  })
})
