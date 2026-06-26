import '../setup'
import './global.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { initBoard } from '@/board/model/board-model'
import { initTheme } from '@/theme/model/theme-model'
import { preloadWidgetChunks } from '@/widget-registry/model/registry'

import { registerAppServiceWorker } from './model/pwa'
import { App } from './ui/App'

initTheme()
initBoard()
registerAppServiceWorker()
preloadWidgetChunks()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
