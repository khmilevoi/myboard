import { createRoot } from 'react-dom/client'

import { HarnessApp } from './harness'

const root = document.getElementById('root')
if (root) createRoot(root).render(<HarnessApp />)
