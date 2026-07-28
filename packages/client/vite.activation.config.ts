import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { resolveAppEnv } from './src/shared/app-env/resolve-app-env'
import { appEnvBranding } from './vite/app-env-branding'

// Standalone activation app: registers new-account WebAuthn devices and
// handles return-login. Built completely separately from the board's
// Vite/Module Federation graph so it can be served on a public, non-gated
// path — no federation or PWA plugins, no board app/widget/storage imports.
// It does reuse the shared shadcn leaf UI primitives and design tokens under
// `@/…` (a small, self-contained set), which is why the `@` alias is wired.
export default defineConfig(({ command }) => {
  // Same contract as vite.config.ts, minus the Vitest branch -- this config is
  // never loaded by a test run. In the production image both builds share one
  // `ENV VITE_APP_ENV`, so the login page and the board always agree.
  const appEnv = resolveAppEnv(
    process.env.VITE_APP_ENV,
    command === 'serve' ? 'local' : 'production',
  )
  if (appEnv instanceof Error) throw appEnv

  return {
    root: 'activation',
    base: '/activate/',
    plugins: [react(), tailwindcss(), appEnvBranding(appEnv)],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    define: {
      __APP_ENV__: JSON.stringify(appEnv),
    },
    build: {
      outDir: '../dist/activate',
      emptyOutDir: true,
    },
  }
})
