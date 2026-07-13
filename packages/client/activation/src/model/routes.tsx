import { atom, effect, reatomRoute, type RouteChild, urlAtom } from '@reatom/core'
import { z } from 'zod'

import { ActivateScreen } from '../ui/ActivateScreen'
import { AddDeviceScreen } from '../ui/AddDeviceScreen'
import { LoadingCard } from '../ui/LoadingCard'
import { Shell } from '../ui/Shell'
import { makeActivationModel } from './activation-model'
import { makeAddDeviceModel } from './add-device-model'

// In-memory return target for the QR scanner. The activation app is a single
// JS context (SPA), so the screen the scanner was opened from is remembered
// here rather than via history.back() (fragile on external deep-links) or a
// URL param (would leak the invite token into the add-device route). null means
// the scanner was reached directly (external QR to /add-device?scan=1) with no
// in-app screen behind it.
export const scanReturn = atom<{ path: string } | null>(null, 'activation.scanReturn')

// Snapshot the current in-app location before navigating into the scanner.
// Called by every "Сканировать QR-код" entry point (home / activate / no-code).
export function recordScanReturn(): void {
  scanReturn.set({ path: urlAtom().pathname + urlAtom().search })
}

// Close the scanner: return to the recorded screen (replace, so browser Back
// does not reopen the scanner), clearing the one-shot target. With nothing
// recorded (external deep-link), fall back to the home login card.
export function closeScan(): void {
  const target = scanReturn()
  if (target) {
    scanReturn.set(null)
    urlAtom.go(target.path, true)
    return
  }
  activateRoute.go({}, true)
}

// Pathless layout: renders the shared card shell and composes the active page
// through `outlet()`. Always active. See the design spec for why the shell
// lives here and the scanner escapes it as a fixed overlay.
export const rootRoute = reatomRoute(
  {
    layout: true,
    render: (self): RouteChild => <Shell>{self.outlet()}</Shell>,
  },
  'rootRoute',
)

// `/activate` (and `/activate?token=...`). Sync loader → the login/registration
// model. `token ?? null` preserves the home / no-code / activate mapping.
export const activateRoute = rootRoute.reatomRoute(
  {
    path: 'activate',
    search: z.object({ token: z.string().optional() }),
    async loader({ token }) {
      return { model: makeActivationModel({ token: token ?? null }) }
    },
    render: (self): RouteChild => {
      // `loader.data()` is `Payload | undefined` (undefined until the first
      // successful load), so narrow via the value, not `loader.ready()`.
      const data = self.loader.data()
      return data ? <ActivateScreen model={data.model} /> : <LoadingCard />
    },
  },
  'activateRoute',
)

// `/add-device` (optionally `?scan=1` or `?token=CODE`). Async loader awaits
// `init()`, so a deep-linked embedded code is server-validated before render
// (the loader's own async context aborts it on navigation — no `effect` needed).
export const addDeviceRoute = rootRoute.reatomRoute(
  {
    path: 'add-device',
    search: z.object({ token: z.string().optional(), scan: z.literal('1').optional() }),
    async loader({ token, scan }) {
      const model = makeAddDeviceModel({ token: token ?? null, scan: scan === '1' })
      await model.init()
      return { model }
    },
    render: (self): RouteChild => {
      const data = self.loader.data()
      return data ? <AddDeviceScreen model={data.model} /> : <LoadingCard />
    },
  },
  'addDeviceRoute',
)

// Neither known route matched the current URL (e.g. bare `/`) — send the
// user to the login screen. This must be a standalone `effect`, not part of
// `rootRoute`'s own `params()`: `rootRoute` is a pathless layout that's
// always "active", so it can't tell child-route mismatches apart on its own,
// and calling `.go()` synchronously from inside `rootRoute`'s own match
// computation would recursively re-trigger that same computation (Reatom's
// "stuck in recursion" guard) since both read and write `urlAtom` in the same
// pass. An `effect` here only depends on the child routes' `.match()`, and
// its callback runs as a deferred subscription, so the `.go()` write is safe.
effect(() => {
  if (!activateRoute.match() && !addDeviceRoute.match()) {
    activateRoute.go({}, true)
  }
}, 'activation.redirectUnmatchedRoute')
