import type { WidgetApi } from '@shared/widgets/contracts'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Dialog } from 'radix-ui'
import { WidgetApiError } from 'widget-runtime'

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
import { RecoveryModal } from './RecoveryModal'

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

// Same fake wiring as RecoveryModal.test.tsx's `setup`, but returns the context
// value instead of rendering — so callers can nest <RecoveryModal /> inside a
// real, OPEN, MODAL Radix dialog and prove the isolation survives that layer.
function makeValue(
  issueResults: Array<RecoveryIssueError | RecoveryIssue> = [{ expiresInMs: 60_000 }],
) {
  const invoke = vi.fn(
    async () => new WidgetApiError({ reason: 'x', code: 'browser_session_required' }),
  )
  const checkModel = makePassportCheckModel({
    api: { invoke } as unknown as WidgetApi<PassportCheckerEvents, WidgetApiError>,
  })
  checkModel.viewState.set({ kind: 'sessionRequired', sshTarget: 'admin@pi' })
  checkModel.recoveryOpen.set(true)

  const results = [...issueResults]
  const transport: RecoveryTransport = {
    issue: async () => {
      const next = results.shift()
      if (!next) return new RecoveryIssueError({ code: 'automation_unavailable' })
      return next
    },
  }
  const recoveryModel = makeRecoveryModel({
    widgetId: 'passport-checker',
    transport,
    makeRfb: (_target, url) => new FakeRfb(url),
    location: { protocol: 'https:', host: 'board.test' },
  })
  const recoveryFlow = makeRecoveryFlow({ checkModel, recoveryModel })

  return { checkModel, value: { checkModel, recoveryModel, recoveryFlow } }
}

function renderNested(overrides?: Array<RecoveryIssueError | RecoveryIssue>) {
  const { checkModel, value } = makeValue(overrides)
  const onOpenChange = vi.fn()

  // Production mounts the board's fullscreen dialog first and the recovery
  // modal later. Mirror that here — our listeners sit on window in the capture
  // phase and Radix's on document, so window still wins whatever the order,
  // but the fixture should not claim an ordering that never happens.
  const view = render(
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>underlying surface</Dialog.Title>
          <button type="button">inside radix</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  )

  view.rerender(
    <Dialog.Root open onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content aria-describedby={undefined}>
          <Dialog.Title>underlying surface</Dialog.Title>
          <button type="button">inside radix</button>
          <passportCheckerContext.Provider value={value}>
            <RecoveryModal restoreFullscreen={vi.fn()} />
          </passportCheckerContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>,
  )

  // Both surfaces are role="dialog". Radix's modal `hideOthers` stamps
  // aria-hidden onto every document.body child outside its own content —
  // including our portal — so an accessible-name query can't see ours. Select
  // it by its stable aria-labelledby instead; the focus/keyboard behavior these
  // tests exercise is unaffected by the a11y-tree hiding.
  const ourDialog = () => {
    const el = document.querySelector<HTMLElement>('[aria-labelledby="passport-recovery-title"]')
    if (!el) throw new Error('our recovery dialog was not rendered')
    return el
  }
  return { checkModel, onOpenChange, ourDialog }
}

// Radix's FocusScope defers its unmount focus-restore to a real
// setTimeout(0) (@radix-ui/react-focus-scope's mount-effect cleanup calls
// `container.dispatchEvent`/`focus(...)` from inside a `setTimeout`, not
// synchronously). Testing-library's auto `cleanup()` — registered as a side
// effect of the `@testing-library/react` import above — unmounts
// synchronously but never waits for that deferred timer, so without an
// explicit flush it can fire during the NEXT test and silently move
// `document.activeElement`. Confirmed by instrumentation: forcing one real
// event-loop tick between tests reliably surfaces both a stray
// `focus(document.body)` call left over from the PRIOR test's Radix dialog
// and an unawaited NoVncCanvas state update from that same prior test's
// async recovery flow — a genuine cross-test leak, present for any suite
// that mounts+unmounts a trapped Radix FocusScope, not something
// `renderNested`'s two-pass mount introduced. Flushing one real tick after
// each test's cleanup lets any such deferred work finish before the next
// test starts, closing the isolation gap instead of racing it.
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('RecoveryModal nested under a modal Radix dialog', () => {
  it('Escape closes ONLY our modal, not the underlying Radix dialog', async () => {
    const { checkModel, onOpenChange, ourDialog } = renderNested()
    await waitFor(() => expect(ourDialog()).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('pulls focus back when the underlying Radix content takes it', () => {
    const { ourDialog } = renderNested()
    const dialog = ourDialog()

    screen.getByRole('button', { name: 'inside radix' }).focus()

    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('keeps focus inside when it moves between two of our own controls', () => {
    const { ourDialog } = renderNested()
    const dialog = ourDialog()

    const buttons = dialog.querySelectorAll('button')
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
      throw new Error('expected at least two buttons in our modal')
    }
    expect(first).not.toBe(last)
    first.focus()

    // A chained `first.focus(); last.focus()` can't observe this: jsdom (like
    // real browsers) always finishes a `.focus()` call on its OWN target once
    // its handler stack unwinds, so even if a nested handler yanks focus away
    // mid-dispatch, the outer call's completion silently overwrites it and
    // `document.activeElement` settles back on `last` regardless of whether
    // our guard did its job — verified empirically against this exact guard.
    // Dispatch the underlying `focusout` event directly instead: that's the
    // one event both our window-capture guard and Radix's document-level
    // `handleFocusOut` react to, so seeing whether it reaches `document`
    // proves whether our guard swallowed it first.
    const reachedDocument = vi.fn()
    document.addEventListener('focusout', reachedDocument)
    try {
      fireEvent.focusOut(first, { relatedTarget: last })

      // Radix's handleFocusOut looks only at relatedTarget, so an intra-modal
      // move would reach it and make it reclaim focus unless our guard
      // swallows the event before it ever gets to document.
      expect(reachedDocument).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('focusout', reachedDocument)
    }
  })
})
