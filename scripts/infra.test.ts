import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { discoverWidgetDirs } from './codegen/shared'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compose = readFileSync(resolve(root, 'docker-compose.dev.yml'), 'utf8')
const e2eCompose = readFileSync(resolve(root, 'docker-compose.e2e.yml'), 'utf8')
const workspace = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
const widgetViteConfig = readFileSync(
  resolve(root, 'packages/widget-sdk/src/vite/widget-vite-config.ts'),
  'utf8',
)
const clientViteConfig = readFileSync(resolve(root, 'packages/client/vite.config.ts'), 'utf8')
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
const nginxConf = readFileSync(resolve(root, 'packages/client/nginx.conf'), 'utf8')

it('exposes each root client definition as the remote client entrypoint', () => {
  expect(widgetViteConfig).toContain("exposes: { './client': './client.ts' }")
  expect(widgetViteConfig).not.toContain("'./ui': './ui/expose.ts'")
})

// @module-federation/dts-plugin generates federation types through the legacy
// TypeScript compiler API (ts.sys, ts.readConfigFile, ts.createProgram), none
// of which typescript@7 ships any more. Leaving DTS on kills the dev server
// with "Cannot read properties of undefined (reading 'readFile')", so every
// federation() call site -- host and remotes -- must opt out.
it('keeps federation DTS generation off on every federation call site', () => {
  expect(widgetViteConfig).toContain('dts: false')
  expect(clientViteConfig).toContain('dts: false')
})

it('routes local commands to the narrowest codegen target', () => {
  expect(rootPackage.scripts.dev).toBe(
    'pnpm run codegen:client && pnpm -r --parallel --filter "./packages/widgets/*" --filter client dev',
  )
  expect(rootPackage.scripts['dev:server']).toBe(
    'pnpm run codegen:server && pnpm --filter server dev',
  )
  expect(rootPackage.scripts.build).toBe(
    'pnpm run codegen:client && concurrently -g --kill-others-on-fail "pnpm --filter \\"./packages/widgets/*\\" build" "pnpm --filter client typecheck" && pnpm --filter client build && pnpm --filter client build:activation',
  )
  expect(rootPackage.scripts['build:widgets']).toBe(
    'pnpm run codegen:client && pnpm --filter "./packages/widgets/*" build',
  )
  expect(rootPackage.scripts.test).toBe('pnpm run codegen && pnpm run test:workspace')
  expect(rootPackage.scripts['test:workspace']).toBe('pnpm run test:unit && pnpm -r test')
  expect(rootPackage.scripts.typecheck).toBe('pnpm run codegen && pnpm run typecheck:workspace')
  expect(rootPackage.scripts['typecheck:workspace']).toBe('pnpm -r typecheck')
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

it('runs only browser codegen in the browser image', () => {
  const browserDockerfile = readFileSync(
    resolve(root, 'packages/browser-automation/Dockerfile'),
    'utf8',
  )
  expect(browserDockerfile).toContain(
    'RUN pnpm run codegen:browser && pnpm --filter browser-automation build',
  )
  expect(browserDockerfile).not.toContain('RUN pnpm run codegen:client')
  expect(browserDockerfile).not.toContain('RUN pnpm run codegen:server')
  expect(browserDockerfile).toContain('FROM node:26-bookworm-slim')
  expect(browserDockerfile).toContain('playwright@1.61.0 install --with-deps chromium')
  expect(browserDockerfile).not.toContain('firefox')
  expect(browserDockerfile).not.toContain('webkit')
  expect(browserDockerfile).toContain('USER node')
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
  // build has a second step on purpose: the runtime stage of the browser image
  // copies only package.json and dist/, so anything rspack leaves external must
  // resolve from the production node_modules alone. A workspace package cannot
  // — its exports map points at .ts sources that never reach the image — and no
  // vitest run can see that, because vitest resolves those specifiers itself
  // and never looks at the bundle. check-bundle.ts asserts it on the artifact,
  // chained onto the build the Dockerfile already runs.
  expect(manifest.scripts).toEqual({
    dev: 'tsx watch src/index.ts',
    start: 'tsx src/index.ts',
    build: 'rspack build && tsx scripts/check-bundle.ts',
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

describe('browser-automation service wiring', () => {
  const prod = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')

  it('binds novnc to the pi loopback only', () => {
    // The host port is variable so a second stack (rpi --env dev) gets its own;
    // the loopback bind and the 6080 container port are the invariant.
    expect(prod).toContain('127.0.0.1:${NOVNC_HOST_PORT:-6080}:6080')
  })

  it('exposes the internal api port without publishing it', () => {
    expect(prod).toContain("- '8788'")
    expect(prod).not.toContain('8788:8788')
  })

  it('mounts passport secrets as scoped /run/secrets targets', () => {
    expect(prod).toContain('target: passport-checker_series')
    expect(prod).toContain('target: passport-checker_number')
  })

  it('sources runtime secrets from file-backed paths under the widget package', () => {
    expect(prod).toContain('file: ./packages/widgets/passport-checker/secrets/series')
    expect(prod).toContain('file: ./packages/widgets/passport-checker/secrets/number')
  })

  it('keeps the browser profile in a named volume', () => {
    expect(prod).toContain('browser_profile:/profile')
  })

  it('provisions a fake diagnostics probe secret in the dev stack only', () => {
    expect(compose).toContain('__diagnostics___probe')
    expect(prod).not.toContain('__diagnostics___probe')
  })

  it('isolates browser-automation on a network reachable only from server', () => {
    expect(prod).toContain('browser_internal')
    const browserAutomationBlock = prod.slice(
      prod.indexOf('  browser-automation:'),
      prod.indexOf('\nvolumes:'),
    )
    expect(browserAutomationBlock).toContain('networks:')
    expect(browserAutomationBlock).toContain('browser_internal')
    expect(browserAutomationBlock).not.toMatch(/networks:\s*\n\s*-\s*default/)

    const serverBlock = prod.slice(prod.indexOf('  server:'), prod.indexOf('  client:'))
    expect(serverBlock).toContain('browser_internal')
  })

  it('grants a stop grace period longer than the browser task timeout', () => {
    const browserAutomationBlock = prod.slice(
      prod.indexOf('  browser-automation:'),
      prod.indexOf('\nvolumes:'),
    )
    expect(browserAutomationBlock).toMatch(/stop_grace_period:\s*75s/)
  })

  it('configures the server gateway without depending on browser startup', () => {
    const serverBlock = prod.slice(prod.indexOf('  server:'), prod.indexOf('  client:'))
    expect(serverBlock).toContain('BROWSER_AUTOMATION_URL: http://browser-automation:8788')
    expect(serverBlock).toContain("BROWSER_AUTOMATION_TIMEOUT_MS: '100000'")
    const dependsOnBlock = serverBlock.slice(
      serverBlock.indexOf('    depends_on:'),
      serverBlock.indexOf('    expose:'),
    )
    expect(dependsOnBlock).not.toContain('browser-automation:')

    const devServerBlock = compose.slice(
      compose.indexOf('  server:'),
      compose.indexOf('  widgets:'),
    )
    expect(devServerBlock).toContain('BROWSER_AUTOMATION_URL: http://browser-automation:8788')
    expect(devServerBlock).toContain("BROWSER_AUTOMATION_TIMEOUT_MS: '100000'")
    const devDependsOnBlock = devServerBlock.slice(devServerBlock.indexOf('    depends_on:'))
    expect(devDependsOnBlock).not.toContain('browser-automation:')
  })
})

describe('recovery websocket ingress', () => {
  const prodCompose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')
  const location = nginxConf.slice(
    nginxConf.indexOf('location = /api/browser/recovery/socket'),
    nginxConf.indexOf('# ---- gated: board statics'),
  )

  it('gates the recovery socket behind the auth subrequest', () => {
    expect(nginxConf).toContain('location = /api/browser/recovery/socket')
    expect(location).toContain('auth_request /internal/auth;')
  })

  it('forwards the websocket upgrade headers', () => {
    expect(location).toContain('proxy_set_header Upgrade $http_upgrade;')
    expect(location).toContain('proxy_set_header Connection "upgrade";')
  })

  it('outlives the maximum recovery session', () => {
    expect(location).toContain('proxy_read_timeout 960s;')
    expect(location).toContain('proxy_send_timeout 960s;')
  })

  it('keeps the vnc bridge on the pi loopback only', () => {
    expect(prodCompose).toContain("- '127.0.0.1:${NOVNC_HOST_PORT:-6080}:6080'")
    expect(nginxConf).not.toContain('6080')
  })
})

describe('rpi dev environment overlay', () => {
  const devOverlay = readFileSync(resolve(root, 'rpi.dev.toml'), 'utf8')
  const devEnvExample = readFileSync(resolve(root, '.env.dev.example'), 'utf8')
  const prodCompose = readFileSync(resolve(root, 'docker-compose.yml'), 'utf8')

  const hostname = /hostname = "([^"]+)"/.exec(devOverlay)?.[1]
  const envValue = (key: string) =>
    new RegExp(`^${key}=(.+)$`, 'm').exec(devEnvExample)?.[1]?.trim()

  it('deploys the dev branch under its own hostname', () => {
    expect(/branch = "dev"/.test(devOverlay)).toBe(true)
    // rpi rejects an environment whose hostname collides with the base project.
    expect(hostname).toBeDefined()
    expect(hostname).not.toBe('board.iiskelo.com')
  })

  it('scopes the webauthn gate to the dev hostname', () => {
    // A mismatch here does not fail the deploy — it silently breaks every
    // registration and login ceremony on the dev host.
    expect(envValue('RP_ID')).toBe(hostname)
    expect(envValue('PUBLIC_APP_URL')).toBe(`https://${hostname}`)
    expect(envValue('EXPECTED_ORIGIN')).toBe(`https://${hostname}`)
  })

  it('keeps dev host ports off production binds and out of the rpi allocator range', () => {
    const prodDefault = (key: string) =>
      Number(new RegExp(`\\$\\{${key}:-(\\d+)\\}`).exec(prodCompose)?.[1])

    for (const key of ['CLIENT_HOST_PORT', 'VALKEY_HOST_PORT', 'NOVNC_HOST_PORT']) {
      const devPort = Number(envValue(key))
      expect(devPort, `${key} must be set in .env.dev.example`).toBeGreaterThan(0)
      expect(devPort, `${key} must not reuse the production bind`).not.toBe(prodDefault(key))
      // rpi allocates the ingress host port from 8000-8999; a fixed bind in
      // that window can collide with a project deployed later.
      expect(devPort < 8000 || devPort > 8999, `${key}=${devPort} sits in 8000-8999`).toBe(true)
    }
  })

  it('keeps the untracked dev secrets bundle out of git', () => {
    expect(gitignore).toContain('.env.dev')
    expect(devOverlay).toContain('env = ".env.dev"')
  })
})

// These TOML files carry long explanatory headers, so a "must not contain"
// assertion has to look at the settings alone — a comment that mentions the
// construct it forbids is documentation, not configuration.
const settingsOf = (toml: string) =>
  toml
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n')

describe('rpi branch environment overlay', () => {
  const baseToml = readFileSync(resolve(root, 'rpi.toml'), 'utf8')
  const devOverlay = readFileSync(resolve(root, 'rpi.dev.toml'), 'utf8')
  const branchOverlay = readFileSync(resolve(root, 'rpi.branch.toml'), 'utf8')
  const branchEnvExample = readFileSync(resolve(root, '.env.branch.example'), 'utf8')

  const hostname = (toml: string) => /hostname = "([^"]+)"/.exec(toml)?.[1]
  const envValue = (key: string) =>
    new RegExp(`^${key}=(.+)$`, 'm').exec(branchEnvExample)?.[1]?.trim()

  it('resolves the deployed branch from the checkout, with no variables to pass', () => {
    expect(branchOverlay).toContain('branch = "${git.branch}"')
    // rpi reads the branch itself, so the deploy is a bare CLI call — and a
    // --vars key nothing references would be a hard error, not a no-op.
    expect(rootPackage.scripts['deploy:branch']).toBe('rpi deploy --env branch')
    expect(settingsOf(branchOverlay)).not.toContain('${BRANCH_NAME}')
  })

  it('keeps the stand on one shared key instead of one per branch', () => {
    // rpi appends --<slug> to the environment key as soon as anything
    // references ${env.slug}. Nothing here may: the stand exists to keep its
    // volumes (and the invited device) across branch switches. The comments
    // explain that at length, hence settingsOf().
    expect(settingsOf(branchOverlay)).not.toContain('${env.slug}')
    expect(branchOverlay).toContain('ttl = "72h"')
  })

  it('scopes the webauthn gate to a hostname of its own', () => {
    // Same silent failure mode as the dev overlay: a mismatch breaks every
    // ceremony instead of failing the deploy.
    expect(hostname(branchOverlay)).toBeDefined()
    expect(hostname(branchOverlay)).not.toBe(hostname(baseToml))
    expect(hostname(branchOverlay)).not.toBe(hostname(devOverlay))
    expect(envValue('RP_ID')).toBe(hostname(branchOverlay))
    expect(envValue('PUBLIC_APP_URL')).toBe(`https://${hostname(branchOverlay)}`)
    expect(envValue('EXPECTED_ORIGIN')).toBe(`https://${hostname(branchOverlay)}`)
  })

  it('keeps the untracked branch secrets source out of git', () => {
    expect(gitignore).toContain('.env.branch')
    expect(branchOverlay).toContain('env = ".env.branch"')
  })

  it('keeps the stand configured through a group that outlives it', () => {
    // `rpi env destroy branch` and the TTL reaper drop the environment's own
    // bundle but never a group, so .env.branch belongs in the `branch` group —
    // declared last, since it overrides what `dev` brings. Being a declared
    // group is also what makes rpi refuse to deploy the stand unconfigured,
    // which a bundle of its own would not: a missing key bundle deploys
    // silently without one.
    expect(branchOverlay).toContain('groups = ["dev", "branch"]')
  })
})

describe('rpi secret groups', () => {
  const baseToml = readFileSync(resolve(root, 'rpi.toml'), 'utf8')
  const devOverlay = readFileSync(resolve(root, 'rpi.dev.toml'), 'utf8')
  const branchOverlay = readFileSync(resolve(root, 'rpi.branch.toml'), 'utf8')

  const groupsOf = (toml: string) => /^groups = \[(.*)\]$/m.exec(settingsOf(toml))?.[1]

  it('delivers the passport files through a group instead of per-environment bundles', () => {
    // The base file is the push source for both production's own bundle and
    // the `dev` group ([secrets].files is read locally by `rpi secrets push`,
    // never at deploy time); the overlays clear it so nothing carries a second
    // copy that would shadow the group.
    expect(baseToml).toContain('packages/widgets/passport-checker/secrets/series')
    for (const overlay of [devOverlay, branchOverlay]) {
      expect(overlay).toContain('files = []')
      expect(settingsOf(overlay)).not.toContain('passport-checker/secrets')
    }
  })

  it('gives production no group of its own', () => {
    // A keyless push always writes this file's env + files into the deploy
    // key's own bundle, and that bundle is the last layer — so a group here
    // could only ever be an identical shadowed copy, and a rotation pushed to
    // it alone would never reach production.
    expect(groupsOf(baseToml)).toBeUndefined()
  })

  it('attaches the groups each environment needs, in precedence order', () => {
    // Arrays replace wholesale, so an overlay that forgot its own `groups`
    // would inherit the base's — nothing — and deploy without the passport
    // files at all. The branch stand adds its own configuration on top of
    // `dev`, so it has to come last: within one layer stack, later wins.
    expect(groupsOf(devOverlay)).toBe('"dev"')
    expect(groupsOf(branchOverlay)).toBe('"dev", "branch"')
  })
})

describe('docker-compose.e2e.yml headed-run support', () => {
  it('publishes valkey to localhost so a host-run Playwright can reach it', () => {
    const valkeyBlock = e2eCompose.slice(
      e2eCompose.indexOf('  valkey:'),
      e2eCompose.indexOf('  e2e:'),
    )
    expect(valkeyBlock).toContain("- '127.0.0.1:6379:6379'")
  })

  it('wires the headed e2e command to the orchestrator script', () => {
    expect(rootPackage.scripts['test:e2e:docker:headed']).toBe(
      'tsx scripts/test-e2e-docker-headed.ts',
    )
  })
})
