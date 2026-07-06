import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Standalone activation app: registers new-account WebAuthn devices and
// handles return-login. Built completely separately from the board's
// Vite/Module Federation graph so it can be served on a public, non-gated
// path — no federation or PWA plugins, no board app/widget/storage imports.
// It does reuse the shared shadcn leaf UI primitives and design tokens under
// `@/…` (a small, self-contained set), which is why the `@` alias is wired.
export default defineConfig({
  root: 'activation',
  base: '/activate/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: '../dist/activate',
    emptyOutDir: true,
  },
})
