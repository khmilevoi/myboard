import * as errore from 'errore'

import type { MakeRfb } from './rfb'

export class RfbLoadError extends errore.createTaggedError({
  name: 'RfbLoadError',
  message: 'The noVNC viewer module failed to load',
}) {}

export type LoadRfb = () => Promise<RfbLoadError | MakeRfb>

/**
 * The only place `./rfb` — and through it `@novnc/novnc` — may be reached from
 * the widget's mount-time graph, and it has to stay a *dynamic* import.
 *
 * `@novnc/novnc@1.7.0`'s `core/util/browser.js` ends in a module-scope top-level
 * await: it builds a real `VideoDecoder`, configures it for 1920x1080
 * `avc1.42401f`, decodes an embedded frame and awaits `decoder.flush()`. That
 * probe resolves in milliseconds on desktop Chrome and never settles at all on
 * some devices (reproduced on an Android phone). A top-level await that never
 * settles parks every module statically importing it in "evaluating" forever.
 *
 * With a static import the chain would be
 * `ui/PassportChecker.tsx -> model/rfb.ts -> @novnc/novnc`, so
 * `import('./ui/PassportChecker')` would never resolve, `React.lazy` would never
 * get a payload, and the board would render this widget's loading card forever —
 * nothing is thrown, so no error boundary fires and the card is
 * indistinguishable from a slow load. `ui/passport-checker-novnc-graph.test.ts`
 * guards that chain.
 *
 * Behind this dynamic import the probe can only ever stall the recovery modal,
 * which is the one surface that actually needs noVNC.
 */
export const loadNoVncRfb: LoadRfb = () =>
  import('./rfb')
    .then((module) => module.makeNoVncRfb)
    .catch((cause: unknown) => new RfbLoadError({ cause }))
