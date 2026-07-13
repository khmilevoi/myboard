import { reatomRoute, type RouteChild } from '@reatom/core'
import { z } from 'zod'

import { ActivateScreen } from '../ui/ActivateScreen'
import { AddDeviceScreen } from '../ui/AddDeviceScreen'
import { LoadingCard } from '../ui/LoadingCard'
import { Shell } from '../ui/Shell'
import { makeAddDeviceModel } from './add-device-model'
import { makeActivationModel } from './activation-model'

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
