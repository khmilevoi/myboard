import path from 'node:path'

import { defineConfig } from '@rspack/cli'

export default defineConfig({
  target: 'node',
  entry: {
    index: './src/index.ts',
    'test-server': './src/test-server.ts',
    'scripts/create-invite': './scripts/create-invite.cli.ts',
    'scripts/list-devices': './scripts/list-devices.cli.ts',
    'scripts/revoke-device': './scripts/revoke-device.cli.ts',
    'scripts/revoke-invite': './scripts/revoke-invite.cli.ts',
    'scripts/revoke-account': './scripts/revoke-account.cli.ts',
    'scripts/mint-add-device-token': './scripts/mint-add-device-token.cli.ts',
  },
  output: {
    path: path.resolve(import.meta.dirname, 'dist'),
    filename: '[name].cjs',
    libraryTarget: 'commonjs2',
    // dev.mjs restarts the server by polling the bundle's mtime; without this,
    // rspack skips rewriting the file when output is byte-identical to what's
    // already on disk (e.g. on a fresh container start), so the mtime never
    // changes and the server never gets (re)spawned.
    compareBeforeEmit: false,
  },
  // Bundle only our own code; resolve dependencies from node_modules at runtime
  // (they're installed in the image), like tsx did. Keeps the bundle small and
  // avoids bundling packages that probe for optional deps (e.g. supports-color).
  externalsType: 'commonjs',
  externals: [
    ({ request }, callback) => {
      if (
        request &&
        !request.startsWith('.') &&
        !request.startsWith('@shared') &&
        !request.startsWith('@widgets') &&
        // errore ships ESM-only (no "require" export condition), so it can't
        // be left as a plain `require('errore')` in the CommonJS output.
        // Bundle it instead of externalizing it.
        request !== 'errore' &&
        !path.isAbsolute(request)
      ) {
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
        options: {
          detectSyntax: 'auto',
        },
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
  watchOptions: process.env.CHOKIDAR_USEPOLLING === 'true' ? { poll: 500 } : undefined,
})
