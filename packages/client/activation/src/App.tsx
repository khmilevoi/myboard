import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { pathname } from './model/router'
import { ActivateScreen } from './ui/ActivateScreen'
import { AddDeviceScreen } from './ui/AddDeviceScreen'
import { Shell } from './ui/Shell'

export const App = reatomMemo(() => {
  const path = pathname()

  return <Shell>{path === '/add-device' ? <AddDeviceScreen /> : <ActivateScreen />}</Shell>
}, 'App')
