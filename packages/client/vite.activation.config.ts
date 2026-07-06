import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Standalone activation app: registers new-account WebAuthn devices and
// handles return-login. Built completely separately from the board's
// Vite/Module Federation graph so it can be served on a public, non-gated
// path — no federation or PWA plugins, no board/widget imports. The only
// shared file it reads is the design-token stylesheet (relative import,
// not a board-wide alias) so the two apps look consistent.
export default defineConfig({
  root: 'activation',
  base: '/activate/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../dist/activate',
    emptyOutDir: true,
  },
})
