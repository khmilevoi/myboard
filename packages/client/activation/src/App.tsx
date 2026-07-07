import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ActivateScreen } from './ui/ActivateScreen'
import { AddDeviceScreen } from './ui/AddDeviceScreen'

function currentPath(): string {
  return typeof location === 'undefined' ? '/activate' : location.pathname
}

export const App = reatomMemo(() => {
  const path = currentPath()

  if (path === '/add-device') {
    return <AddDeviceScreen />
  }

  return <ActivateScreen />
}, 'App')
