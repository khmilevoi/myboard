import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { pathname } from './model/router'
import { ActivateScreen } from './ui/ActivateScreen'
import { AddDeviceScreen } from './ui/AddDeviceScreen'

export const App = reatomMemo(() => {
  const path = pathname()

  if (path === '/add-device') {
    return <AddDeviceScreen />
  }

  return <ActivateScreen />
}, 'App')
