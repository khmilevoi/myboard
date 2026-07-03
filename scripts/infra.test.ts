import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { discoverWidgetDirs } from './codegen/shared'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compose = readFileSync(resolve(root, 'docker-compose.dev.yml'), 'utf8')
const widgetViteConfig = readFileSync(
  resolve(root, 'packages/widget-sdk/src/vite/widget-vite-config.ts'),
  'utf8',
)
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const clientDockerfile = readFileSync(resolve(root, 'packages/client/Dockerfile'), 'utf8')
const serverDockerfile = readFileSync(resolve(root, 'packages/server/Dockerfile'), 'utf8')
const ports = JSON.parse(
  readFileSync(resolve(root, 'packages/widgets/.ports.json'), 'utf8'),
) as Record<string, number>

it('exposes each root client definition as the remote client entrypoint', () => {
  expect(widgetViteConfig).toContain("exposes: { './client': './client.ts' }")
  expect(widgetViteConfig).not.toContain("'./ui': './ui/expose.ts'")
})

it('routes local commands to the narrowest codegen target', () => {
  expect(rootPackage.scripts.dev).toContain('codegen:client')
  expect(rootPackage.scripts['dev:server']).toContain('codegen:server')
  expect(rootPackage.scripts.build).toContain('codegen:client')
  expect(rootPackage.scripts.test).toContain('pnpm run codegen')
  expect(rootPackage.scripts.typecheck).toContain('pnpm run codegen')
})

it('runs only client codegen in the client image', () => {
  expect(clientDockerfile).toContain('pnpm run codegen:client')
})

it('runs only server codegen in the server image', () => {
  expect(serverDockerfile).toContain('pnpm run codegen:server')
  expect(serverDockerfile).not.toContain('imports every widgets/*/client.ts')
})

describe('docker-compose.dev.yml widget coverage', () => {
  it('publishes a host port range covering every widget dev port', () => {
    const match = compose.match(/['"](\d+)-(\d+):\1-\2['"]/)
    expect(match, 'a published port range like 5180-5199:5180-5199').not.toBeNull()
    const from = Number(match![1])
    const to = Number(match![2])
    for (const [id, port] of Object.entries(ports)) {
      expect(port, `${id} dev port inside published range`).toBeGreaterThanOrEqual(from)
      expect(port, `${id} dev port inside published range`).toBeLessThanOrEqual(to)
    }
  })

  it('mounts a named node_modules volume for every workspace package', () => {
    const widgetDirsResult = discoverWidgetDirs(resolve(root, 'packages/widgets'))
    if (widgetDirsResult instanceof Error) throw widgetDirsResult
    const widgetDirs = widgetDirsResult
    const required = [
      'packages/client',
      'packages/server',
      'packages/shared',
      'packages/widget-runtime',
      'packages/widget-sdk',
      ...widgetDirs.map((dir) => `packages/widgets/${dir}`),
    ]
    for (const pkg of required) {
      expect(compose, `${pkg} node_modules named volume`).toContain(`/app/${pkg}/node_modules`)
    }
  })

  it('runs codegen before dev servers start (generated files are untracked)', () => {
    expect(compose).toContain('pnpm run codegen')
  })

  it('keeps the pnpm store off the bind mount', () => {
    expect(compose).toContain('pnpm_store:/pnpm-store')
    expect(compose).toContain('npm_config_store_dir: /pnpm-store')
  })
})

describe('docker-compose.yml production hardening', () => {
  const prodCompose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')

  it('persists valkey data in a named volume', () => {
    expect(prodCompose).toContain('valkey_data:/data')
  })

  it('restarts every service and gates on health', () => {
    expect(prodCompose.match(/restart: unless-stopped/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
    expect(prodCompose).toContain('condition: service_healthy')
  })

  it('keeps generated files out of the docker build context', () => {
    const dockerignore = readFileSync(resolve(root, '.dockerignore'), 'utf8')
    expect(dockerignore).toContain('*.generated.ts')
  })
})
