import { urlAtom } from '@reatom/core'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initTheme } from '@/theme/model/theme-model'

import { App } from './App'

import './global.css'

// Resolve stored/system theme and apply <html data-theme> before first paint,
// mirroring the board host so the activation app themes identically.
initTheme()
// No in-app <a> navigation; the board '/' is a hard load to a separate bundle.
// Disabling link interception keeps a future <a href="/"> from being hijacked
// into SPA navigation. urlAtom subscribes to popstate itself once connected.
urlAtom.catchLinks.set(false)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
