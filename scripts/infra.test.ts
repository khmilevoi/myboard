import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { discoverWidgetDirs } from './codegen/shared'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compose = readFileSync(resolve(root, 'docker-compose.dev.yml'), 'utf8')
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
const widgetViteConfig = readFileSync(
  resolve(root, 'packages/widget-sdk/src/vite/widget-vite-config.ts'),
  'utf8',
)
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8')
const rootCodegen = readFileSync(resolve(root, 'scripts/codegen.ts'), 'utf8')
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
  expect(rootPackage.scripts.dev).toBe(
    'pnpm run codegen:client && pnpm -r --parallel --filter "./packages/widgets/*" --filter client dev',
  )
  expect(rootPackage.scripts['dev:server']).toBe(
    'pnpm run codegen:server && pnpm --filter server dev',
  )
  expect(rootPackage.scripts.build).toBe(
    'pnpm run codegen:client && concurrently -g --kill-others-on-fail "pnpm --filter ./packages/widgets/* build" "pnpm --filter client typecheck" && pnpm --filter client build',
  )
  expect(rootPackage.scripts['build:widgets']).toBe(
    'pnpm run codegen:client && pnpm --filter "./packages/widgets/*" build',
  )
  expect(rootPackage.scripts.test).toBe('pnpm run codegen && pnpm run test:scripts && pnpm -r test')
  expect(rootPackage.scripts.typecheck).toBe('pnpm run codegen && pnpm -r typecheck')
})

it('runs only client codegen in the client image', () => {
  expect(clientDockerfile).toContain(
    'RUN pnpm run codegen:client \\\n    && pnpm --filter "./packages/widgets/*" build \\\n    && pnpm --filter client exec vite-build-exit',
  )
  expect(clientDockerfile).not.toMatch(/RUN pnpm run codegen(?:\s|\\)/)
  expect(clientDockerfile).not.toContain('RUN pnpm run codegen:server')
})

it('runs only server codegen in the server image', () => {
  expect(serverDockerfile).toContain('RUN pnpm run codegen:server && pnpm --filter server build')
  expect(serverDockerfile).not.toMatch(/RUN pnpm run codegen(?:\s|\\)/)
  expect(serverDockerfile).not.toContain('RUN pnpm run codegen:client')
  expect(serverDockerfile).not.toContain('imports every widgets/*/client.ts')
})

it('registers the lightweight browser automation workspace package', () => {
  expect(workspace).toContain('  - packages/browser-automation')
  const manifest = JSON.parse(
    readFileSync(resolve(root, 'packages/browser-automation/package.json'), 'utf8'),
  ) as {
    name: string
    scripts: Record<string, string>
  }

  expect(manifest.name).toBe('browser-automation')
  expect(manifest.scripts).toEqual({
    dev: 'tsx watch src/index.ts',
    start: 'tsx src/index.ts',
    test: 'vitest run',
    typecheck: 'tsc --noEmit -p tsconfig.json',
  })
})

it('wires browser codegen as an isolated target and into combined codegen', () => {
  expect(rootPackage.scripts['codegen:browser']).toBe('tsx scripts/codegen.ts browser')
  expect(rootCodegen).toContain("if (target === 'browser') return generateBrowser")
  expect(rootCodegen).toContain('const browserOutputs = prepareBrowser(defaultCodegenPaths)')
  expect(rootCodegen).toContain(
    'writeGeneratedOutputs([...clientOutputs, ...serverOutputs, ...browserOutputs])',
  )
  expect(gitignore).toContain(
    'packages/browser-automation/src/tasks/widget-browser-list.generated.ts',
  )
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
