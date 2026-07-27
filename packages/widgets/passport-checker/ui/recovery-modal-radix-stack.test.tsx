import type { WidgetApi } from '@shared/widgets/contracts'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Dialog } from 'radix-ui'
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
import type { MakeRfb, RfbLike } from '../model/rfb'
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
    storage: createFakeStorage(),
  })
  checkModel.transient.set({ kind: 'sessionRequired', sshTarget: 'admin@pi', novncPort: 6080 })
  checkModel.recoveryOpen.set(true)

  const results = [...issueResults]
  const transport: RecoveryTransport = {
    issue: async () => {
      const next = results.shift()
      if (!next) return new RecoveryIssueError({ code: 'automation_unavailable' })
      return next
    },
  }
  const makeRfb: MakeRfb = (_target, url) => new FakeRfb(url)
  const recoveryModel = makeRecoveryModel({
    widgetId: 'passport-checker',
    transport,
    loadRfb: async () => makeRfb,
    location: { protocol: 'https:', host: 'board.test' },
  })
  const recoveryFlow = makeRecoveryFlow({ checkModel, recoveryModel })

  return { checkModel, value: { checkModel, recoveryModel, recoveryFlow } }
}

async function renderNested(overrides?: Array<RecoveryIssueError | RecoveryIssue>) {
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

  // NoVncCanvas's mount effect starts the recovery model, which lands its
  // `issuing -> connecting` transition a few microtasks later: it awaits the
  // capability request together with the lazily imported noVNC viewer
  // (model/load-rfb.ts). Flush that continuation inside act() here, so the
  // synchronous tests below cannot have it repaint mid-assertion — and so it
  // does not warn about an update outside act().
  await act(async () => {})

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

// Radix's FocusScope defers its unmount focus-restore to a real setTimeout(0):
// the mount effect's cleanup does not restore focus itself, it schedules
// `focus(previouslyFocusedElement ?? document.body)` for the next macrotask
// (@radix-ui/react-focus-scope@1.1.10, dist/index.mjs:87-99). Testing-library's
// auto `cleanup()` unmounts synchronously and never waits for that timer, so it
// is still queued when the NEXT test begins.
//
// This drain has to be a `beforeEach`, not an `afterEach`. Vitest resolves
// `sequence.hooks` to "stack", under which same-suite `afterEach` hooks run in
// REVERSE registration order — and testing-library's `cleanup()` is registered
// first, at setupFiles import time. A file-level `afterEach` added here would
// therefore run BEFORE the unmount that schedules the timer and could not
// possibly drain it. Every `beforeEach` runs after every `afterEach` of the
// previous test regardless of hook-order mode, which makes this placement
// correct by construction rather than by registration luck.
//
// Measured on this file by instrumenting `setTimeout` and logging hook
// boundaries: at `beforeEach` entry one FocusScope timer is pending; after
// this tick, zero. Only that 1 -> 0 transition was recorded — no larger
// pending count was ever observed. Scope of the claim: this closes a scheduling
// leak, not an observed failure. The restore is focus-neutral in this fixture
// today — the `previouslyFocusedElement` it captured is either `document.body`
// (which jsdom refuses to focus, so the call is a no-op) or an already-detached
// node — and the tests below did not fail in 30 consecutive file runs or 6
// whole-package runs without it. What it buys is that a test which awaits
// cannot inherit the previous test's queued focus work.
beforeEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
})

describe('RecoveryModal nested under a modal Radix dialog', () => {
  it('Escape closes ONLY our modal, not the underlying Radix dialog', async () => {
    const { checkModel, onOpenChange, ourDialog } = await renderNested()
    await waitFor(() => expect(ourDialog()).toBeInTheDocument())

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(checkModel.recoveryOpen()).toBe(false)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
  })

  it('pulls focus back when the underlying Radix content takes it', async () => {
    const { ourDialog } = await renderNested()
    const dialog = ourDialog()

    screen.getByRole('button', { name: 'inside radix' }).focus()

    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('swallows the focusout of a move between two of our own controls before it reaches document', async () => {
    const { ourDialog } = await renderNested()
    const dialog = ourDialog()

    const buttons = dialog.querySelectorAll('button')
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (!(first instanceof HTMLElement) || !(last instanceof HTMLElement)) {
      throw new Error('expected at least two buttons in our modal')
    }
    expect(first).not.toBe(last)
    first.focus()

    // A chained `first.focus(); last.focus()` can't observe this: in jsdom a
    // `.focus()` call always finishes on its OWN target once its handler stack
    // unwinds, so even if a nested handler yanks focus away mid-dispatch, the
    // outer call's completion silently overwrites it and
    // `document.activeElement` settles back on `last` regardless of whether
    // our guard did its job — verified empirically against this exact guard,
    // in jsdom only; nothing here was measured against a real browser.
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
