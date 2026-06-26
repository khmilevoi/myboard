import '../setup'
import './global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initTheme } from '../theme/model/theme-model'
import { App } from './ui/App'

initTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
