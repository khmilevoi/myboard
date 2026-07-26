import { createRoot } from 'react-dom/client'

import { HarnessApp } from './harness'

import './dev-tokens.css'

const root = document.getElementById('root')
if (root) createRoot(root).render(<HarnessApp />)
