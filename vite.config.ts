import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { existsSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const widgetsDir = resolve(__dirname, 'widgets')

// Auto-discover every widget entry (widgets/<name>/index.html) so adding a new
// widget directory is enough — no need to edit this config by hand.
function widgetEntries(): Record<string, string> {
  if (!existsSync(widgetsDir)) return {}
  const entries: Record<string, string> = {}
  for (const dirent of readdirSync(widgetsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue
    const indexHtml = resolve(widgetsDir, dirent.name, 'index.html')
    if (existsSync(indexHtml)) entries[`widget-${dirent.name}`] = indexHtml
  }
  return entries
}

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...widgetEntries(),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/vitest.setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})
