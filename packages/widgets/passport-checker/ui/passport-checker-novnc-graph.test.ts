// Counts *evaluations* of @novnc/novnc: the factory runs the first time
// something in this module registry actually pulls the package in.
const novnc = vi.hoisted(() => ({ evaluations: 0 }))

vi.mock('@novnc/novnc', () => {
  novnc.evaluations += 1
  return { default: class FakeRFB {} }
})

// This file must stay a single test that imports nothing else from the widget:
// the subject is what the mount-time graph pulls in, and any earlier import of
// model/rfb.ts — even from a sibling test in the same file — would decide the
// assertion for the wrong reason.
describe('passport-checker mount graph', () => {
  it('does not pull @novnc/novnc in when the widget component is imported', async () => {
    await import('./PassportChecker')

    // @novnc/novnc@1.7.0 ends core/util/browser.js in a top-level await on a
    // real VideoDecoder probe that never settles on some devices. Anything
    // reachable from React.lazy(() => import('./ui/PassportChecker')) inherits
    // that stall, and the board is left rendering this widget's loading card
    // forever with nothing thrown, so no error boundary fires. Reach noVNC
    // through model/load-rfb.ts's dynamic import, never through a static one.
    expect(novnc.evaluations).toBe(0)
    // The single `await` above is a cold import of the widget's whole mount
    // graph — React, Reatom, widget-sdk, the model layer — transformed from
    // scratch in a fresh module registry. That is the entire cost of this test,
    // and it overran the default 5s budget under `pnpm check`, which runs five
    // workspace gates concurrently. Nothing here waits on behaviour, so the
    // wider budget cannot mask a regression: a real one fails the assertion.
  }, 20_000)
})
