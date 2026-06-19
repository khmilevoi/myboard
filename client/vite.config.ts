import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    execArgv: ['--harmony-temporal'],
  },
  server: {
    // Inside a Docker bind mount (notably on Windows/macOS) native FS events
    // don't propagate, so HMR misses changes. docker-compose.dev.yml sets
    // CHOKIDAR_USEPOLLING=true to switch the watcher to polling. Outside
    // Docker this is unset, so normal `pnpm dev` keeps native watching.
    watch:
      process.env.CHOKIDAR_USEPOLLING === 'true'
        ? { usePolling: true, interval: 100 }
        : undefined,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY ?? 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
})
