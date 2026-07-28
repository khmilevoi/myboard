import { readFileSync } from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'

import { defineConfig } from '@rspack/cli'

const manifest = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
) as { dependencies?: Record<string, string> }

// errore is ESM-only with no CJS require condition, so it is bundled rather
// than externalized.
const runtimeDependencies = new Set(
  Object.keys(manifest.dependencies ?? {}).filter((name) => name !== 'errore'),
)

function packageNameOf(request: string) {
  const segments = request.split('/')
  return request.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

/**
 * Externalize exactly the runtime dependencies that `pnpm install --prod`
 * places into the runtime image, plus Node builtins. Everything else is
 * bundled: our own `src`, the `@shared`/`@widgets` aliases, and — the case this
 * shape exists for — workspace packages imported by their bare package name,
 * such as `browser-automation/user-input/cloudflare` from a widget's browser
 * task.
 *
 * This is a deny-list on purpose. The previous allow-list ("anything bare that
 * is not `.`/`@shared`/`@widgets`/`errore` is external") silently externalized
 * that import: its `exports` entry points at a `.ts` file that is not copied
 * into the runtime stage of the Dockerfile, so the container died on
 * `require()` at startup while every test and the build itself stayed green.
 * With a deny-list an unrecognised bare specifier is bundled instead, so the
 * same mistake surfaces as a build-time resolution error.
 */
function isExternalRequest(request: string) {
  if (request.startsWith('.') || path.isAbsolute(request)) return false
  if (request.startsWith('node:') || builtinModules.includes(request)) return true
  return runtimeDependencies.has(packageNameOf(request))
}

export default defineConfig({
  target: 'node',
  entry: { index: './src/index.ts' },
  output: {
    path: path.resolve(import.meta.dirname, 'dist'),
    filename: '[name].cjs',
    libraryTarget: 'commonjs2',
    compareBeforeEmit: false,
  },
  // Bundle only our own code; resolve declared dependencies (playwright,
  // find-my-way, zod) from node_modules at runtime. See isExternalRequest.
  externalsType: 'commonjs',
  externals: [
    ({ request }, callback) => {
      if (request && isExternalRequest(request)) {
        return callback(undefined, `commonjs ${request}`)
      }
      callback()
    },
  ],
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        loader: 'builtin:swc-loader',
        options: { detectSyntax: 'auto' },
        type: 'javascript/auto',
      },
    ],
  },
  resolve: {
    alias: {
      '@shared': path.resolve(import.meta.dirname, '../shared'),
      '@widgets': path.resolve(import.meta.dirname, '../widgets'),
    },
    extensions: ['.ts', '.js'],
  },
})
