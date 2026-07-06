import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { ActivateScreen } from './ui/ActivateScreen'

function currentPath(): string {
  return typeof location === 'undefined' ? '/activate' : location.pathname
}

// Plan 2 wires the `/add-device` scan/approve flow; keep the branch present
// but stubbed so routing already resolves it correctly.
export const App = reatomMemo(() => {
  const path = currentPath()

  if (path === '/add-device') {
    return <div>Add device — coming soon.</div>
  }

  return <ActivateScreen />
}, 'App')
