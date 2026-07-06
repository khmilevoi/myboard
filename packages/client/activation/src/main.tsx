import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initTheme } from '@/theme/model/theme-model'

import { App } from './App'

import './global.css'

// Resolve stored/system theme and apply <html data-theme> before first paint,
// mirroring the board host so the activation app themes identically.
initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
