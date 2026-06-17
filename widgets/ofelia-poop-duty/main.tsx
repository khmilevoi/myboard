import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createWidgetClient } from '../../src/shared/widget-bridge'
import '../../src/shared/theme/tokens.css'
import { OfeliaPoopDuty } from './OfeliaPoopDuty'

const root = createRoot(document.getElementById('root')!)

const client = await createWidgetClient()
if (client instanceof Error) {
  root.render(
    <div style={{ color: 'var(--accent)', padding: 16, fontFamily: 'var(--font-ui)' }}>
      Bridge error: {client.message}
    </div>,
  )
} else {
  document.documentElement.dataset.theme = client.theme
  client.onThemeChange((theme) => {
    document.documentElement.dataset.theme = theme
  })
  root.render(
    <StrictMode>
      <OfeliaPoopDuty client={client} />
    </StrictMode>,
  )
}
