import { defineConfig } from '@rspack/cli'
import path from 'node:path'

export default defineConfig({
  target: 'node',
  entry: './src/index.ts',
  output: {
    path: path.resolve(import.meta.dirname, 'dist'),
    filename: 'index.cjs',
    libraryTarget: 'commonjs2',
  },
  // Bundle only our own code; resolve dependencies from node_modules at runtime
  // (they're installed in the image), like tsx did. Keeps the bundle small and
  // avoids bundling packages that probe for optional deps (e.g. supports-color).
  externalsType: 'commonjs',
  externals: [
    ({ request }, callback) => {
      if (request && !request.startsWith('.') && !path.isAbsolute(request)) {
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
    },
    extensions: ['.ts', '.js'],
  },
  watchOptions: process.env.CHOKIDAR_USEPOLLING === 'true' ? { poll: 500 } : undefined,
})
