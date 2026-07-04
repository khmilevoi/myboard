import path from 'node:path'

import { defineConfig } from '@rspack/cli'

export default defineConfig({
  target: 'node',
  entry: { index: './src/index.ts' },
  output: {
    path: path.resolve(import.meta.dirname, 'dist'),
    filename: '[name].cjs',
    libraryTarget: 'commonjs2',
    compareBeforeEmit: false,
  },
  // Bundle only our own code; resolve dependencies (playwright, find-my-way,
  // zod) from node_modules at runtime. errore is ESM-only with no CJS require
  // condition, so it is bundled rather than externalized.
  externalsType: 'commonjs',
  externals: [
    ({ request }, callback) => {
      if (
        request &&
        !request.startsWith('.') &&
        !request.startsWith('@shared') &&
        !request.startsWith('@widgets') &&
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
