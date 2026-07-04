import fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = fs

import { emitBrowserList, generateBrowser } from './codegen/browser'
import {
  emitCatalog,
  emitIcons,
  generateClient,
  InvalidWidgetClientDefinitionError,
  type WidgetMeta,
} from './codegen/client'
import { emitServerList, generateServer } from './codegen/server'
import {
  assignPorts,
  identifierFromDirectory,
  InvalidCodegenTargetError,
  InvalidPortsConfigError,
  MissingWidgetEntrypointError,
  parseCodegenTarget,
  PortAllocationError,
  writeGeneratedOutputs,
  type CodegenPaths,
} from './codegen/shared'

const metas: WidgetMeta[] = [
  {
    dir: 'clock',
    title: 'Часы',
    description: 'Текущее время и дата',
    defaultSize: { w: 3, h: 4, minW: 2, minH: 2 },
    icon: 'Clock',
  },
]

describe('codegen emitters', () => {
  it('injects directory IDs and loads remote client definitions', () => {
    const out = emitCatalog(metas)
    expect(out).toContain('id: "clock"')
    expect(out).toContain('loadRemote<')
    expect(out).toContain('`${id}/client`')
    expect(out).toContain('definition.loadComponent()')
    expect(out).not.toContain('/ui')
  })

  it('defers loading remote client definitions until the component loader runs', () => {
    const out = emitCatalog(metas)
    expect(out).toContain('loadComponent: () => loadRemoteModule("clock")')
    expect(out).not.toContain('loadComponent: loadRemoteModule("clock")')
  })

  it('derives a closed icon union + map from the icons actually used', () => {
    const out = emitIcons(metas)
    expect(out).toContain("import { Clock } from 'lucide-react'")
    expect(out).toContain("export type WidgetIconName = 'Clock'")
  })

  it('emits valid icon types when no widgets exist', () => {
    const out = emitIcons([])
    expect(out).toContain('export type WidgetIconName = never')
    expect(out).toContain('= {}')
    expect(out).not.toContain('import {  }')
  })

  it('emits the server list from directory names alone', () => {
    const out = emitServerList(['clock', 'ofelia-poop-duty'])
    expect(out).toContain("import clock from '@widgets/clock/server'")
    expect(out).toContain("import ofeliaPoopDuty from '@widgets/ofelia-poop-duty/server'")
    expect(out).toContain('typeId: "clock"')
    expect(out).toContain('definition: clock')
    expect(out).toContain('definition: ofeliaPoopDuty')
  })

  it('disambiguates directory names with the same camel-case binding', () => {
    const out = emitServerList(['foo-bar', 'fooBar'])
    expect(out).toContain("import fooBar from '@widgets/foo-bar/server'")
    expect(out).toContain("import fooBar$2 from '@widgets/fooBar/server'")
  })

  it('emits browser definitions with directory-derived widget IDs', () => {
    const out = emitBrowserList(['clock', 'ofelia-poop-duty'])
    expect(out).toContain("import clock from '@widgets/clock/browser'")
    expect(out).toContain("import ofeliaPoopDuty from '@widgets/ofelia-poop-duty/browser'")
    expect(out).toContain('widgetId: "clock"')
    expect(out).toContain('definition: ofeliaPoopDuty')
  })

  it('emits a valid empty browser list', () => {
    const out = emitBrowserList([])
    expect(out).toContain('export const widgetBrowserList = [')
    expect(out).not.toContain('@widgets/')
  })

  it('disambiguates browser bindings with the same camel-case identifier', () => {
    const out = emitBrowserList(['foo-bar', 'fooBar'])
    expect(out).toContain("import fooBar from '@widgets/foo-bar/browser'")
    expect(out).toContain("import fooBar$2 from '@widgets/fooBar/browser'")
  })

  it('keeps existing ports and appends max+1 for new widgets', () => {
    const assigned = assignPorts(['clock', 'ofelia-poop-duty'], {})
    expect(assigned).toEqual({
      clock: 5180,
      'ofelia-poop-duty': 5181,
    })
    expect(assignPorts(['aa', 'clock'], { clock: 5180 })).toEqual({ clock: 5180, aa: 5181 })
  })

  it('returns a typed error when allocating beyond the TCP port range', () => {
    expect(assignPorts(['existing', 'new-widget'], { existing: 65_535 })).toBeInstanceOf(
      PortAllocationError,
    )
  })

  it('parses supported targets and rejects unknown targets', () => {
    expect(parseCodegenTarget('invalid')).toBeInstanceOf(InvalidCodegenTargetError)
    expect(parseCodegenTarget('server')).toBe('server')
    expect(parseCodegenTarget('browser')).toBe('browser')
  })

  it('creates readable, legal, and reserved-safe bindings', () => {
    const directories = ['1-clock', 'with.dot', 'class', 'widget$31']
    const identifiers = directories.map(identifierFromDirectory)
    expect(identifiers.every((identifier) => /^[A-Za-z_$][\w$]*$/.test(identifier))).toBe(true)
    expect(identifiers).toHaveLength(new Set(identifiers).size)
    expect(identifiers).not.toContain('class')
    expect(identifierFromDirectory('ofelia-poop-duty')).toBe('ofeliaPoopDuty')
  })
})

describe('codegen generation', () => {
  it('generates a server registry without importing client entrypoints', () => {
    const root = mkdtempSync(join(tmpdir(), 'server-codegen-'))
    const widgetsDir = join(root, 'widgets')
    const widgetDir = join(widgetsDir, 'probe')
    const serverListFile = join(root, 'widget-server-list.generated.ts')
    mkdirSync(widgetDir, { recursive: true })
    writeFileSync(join(widgetDir, 'package.json'), '{"name":"widgets-probe"}')
    writeFileSync(join(widgetDir, 'server.ts'), 'export default {}')
    writeFileSync(join(widgetDir, 'client.ts'), "throw new Error('must not import client')")
    const result = generateServer({ widgetsDir, serverListFile })
    expect(result).not.toBeInstanceOf(Error)
    expect(readFileSync(serverListFile, 'utf8')).toContain('@widgets/probe/server')
  })

  it('fails client codegen when client.ts is missing', async () => {
    const paths = createTempCodegenPaths('missing-client')
    writeFileSync(join(paths.widgetsDir, 'probe', 'server.ts'), 'export default {}')
    expect(await generateClient(paths)).toBeInstanceOf(MissingWidgetEntrypointError)
  })

  it('omits widgets without server.ts from server codegen', () => {
    const paths = createTempCodegenPaths('missing-server')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), 'export default {}')
    expect(generateServer(paths)).not.toBeInstanceOf(Error)
    const output = readFileSync(paths.serverListFile, 'utf8')
    expect(output).toBe(emitServerList([]))
    expect(output).not.toContain('@widgets/probe/server')
  })

  it('discovers browser.ts without executing any widget entrypoint', () => {
    const paths = createTempCodegenPaths('browser-isolation')
    const widgetDir = join(paths.widgetsDir, 'probe')
    writeFileSync(join(widgetDir, 'browser.ts'), "throw new Error('must not import browser')")
    writeFileSync(join(widgetDir, 'client.ts'), "throw new Error('must not import client')")
    writeFileSync(join(widgetDir, 'server.ts'), "throw new Error('must not import server')")

    expect(generateBrowser(paths)).not.toBeInstanceOf(Error)
    const output = readFileSync(paths.browserListFile, 'utf8')
    expect(output).toContain('@widgets/probe/browser')
    expect(output).not.toContain('@widgets/probe/client')
    expect(output).not.toContain('@widgets/probe/server')
  })

  it('omits widgets without an optional browser.ts entrypoint', () => {
    const paths = createTempCodegenPaths('browser-optional')
    expect(generateBrowser(paths)).not.toBeInstanceOf(Error)
    expect(readFileSync(paths.browserListFile, 'utf8')).not.toContain('@widgets/probe/browser')
  })

  it('orders discovered browser entrypoints deterministically', () => {
    const paths = createTempCodegenPaths('browser-order')
    for (const widgetId of ['zeta', 'alpha']) {
      const widgetDir = join(paths.widgetsDir, widgetId)
      mkdirSync(widgetDir, { recursive: true })
      writeFileSync(
        join(widgetDir, 'package.json'),
        JSON.stringify({ name: `widgets-${widgetId}` }),
      )
      writeFileSync(join(widgetDir, 'browser.ts'), 'export default {}')
    }

    expect(generateBrowser(paths)).not.toBeInstanceOf(Error)
    const output = readFileSync(paths.browserListFile, 'utf8')
    expect(output.indexOf('@widgets/alpha/browser')).toBeLessThan(
      output.indexOf('@widgets/zeta/browser'),
    )
  })

  it.each(['{"probe":"5180"}', '{"probe":null}', '{"probe":1e999}', '[]'])(
    'returns a tagged error for malformed ports config %s',
    async (config) => {
      const paths = createTempCodegenPaths('invalid-ports')
      writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), validClientDefinition())
      writeFileSync(paths.portsFile, config)
      expect(await generateClient(paths)).toBeInstanceOf(InvalidPortsConfigError)
    },
  )

  it.each(['{"probe":0}', '{"probe":65536}', '{"probe":5180,"other":5180}'])(
    'rejects out-of-range or duplicate ports %s',
    async (config) => {
      const paths = createTempCodegenPaths('invalid-port-boundary')
      writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), validClientDefinition())
      writeFileSync(paths.portsFile, config)
      expect(await generateClient(paths)).toBeInstanceOf(InvalidPortsConfigError)
    },
  )

  it('returns a tagged error for malformed client definitions', async () => {
    const paths = createTempCodegenPaths('invalid-client')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), 'export default { title: 42 }')
    expect(await generateClient(paths)).toBeInstanceOf(InvalidWidgetClientDefinitionError)
  })

  it.each([
    "icon: 'bad-icon'",
    "icon: 'Clock', defaultSize: { w: 1, h: 1, minW: 0 }",
    "icon: 'Clock', defaultSize: { w: 1, h: 1, minH: Infinity }",
  ])('rejects client metadata that cannot be emitted safely: %s', async (fields) => {
    const paths = createTempCodegenPaths('invalid-client-fields')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), clientDefinition(fields))
    expect(await generateClient(paths)).toBeInstanceOf(InvalidWidgetClientDefinitionError)
  })

  it.each([
    'const tiers = {}; tiers.self = tiers; export default { tiers,',
    'export default { tiers: { value: 1n },',
  ])('returns a tagged error for nonserializable metadata', async (prefix) => {
    const paths = createTempCodegenPaths('nonserializable-client')
    writeFileSync(
      join(paths.widgetsDir, 'probe', 'client.ts'),
      `${prefix}
      title: 'Probe', description: 'Probe', defaultSize: { w: 1, h: 1 },
      icon: 'Clock', loadComponent: () => Promise.resolve({ default: () => null }) }`,
    )
    expect(await generateClient(paths)).toBeInstanceOf(InvalidWidgetClientDefinitionError)
  })

  it.each([
    'tiers: 1',
    'tiers: []',
    'tiers: { tiny: { minWidthPx: 0, minHeightPx: 0 }, arbitrary: {} }',
    `tiers: {
      tiny: { minWidthPx: 0, minHeightPx: 0 }, compact: { minWidthPx: 1, minHeightPx: 1 },
      standard: { minWidthPx: 2, minHeightPx: 2 }, large: { minWidthPx: Infinity, minHeightPx: 3 }
    }`,
  ])('rejects invalid TierConfig metadata: %s', async (tiers) => {
    const paths = createTempCodegenPaths('invalid-tiers')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), clientDefinition(tiers))
    expect(await generateClient(paths)).toBeInstanceOf(InvalidWidgetClientDefinitionError)
  })

  it('accepts the authoritative TierConfig structure', async () => {
    const paths = createTempCodegenPaths('valid-tiers')
    writeFileSync(
      join(paths.widgetsDir, 'probe', 'client.ts'),
      clientDefinition(`tiers: {
      tiny: { minWidthPx: 0, minHeightPx: 0 }, compact: { minWidthPx: 1, minHeightPx: 1 },
      standard: { minWidthPx: 2, minHeightPx: 2 }, large: { minWidthPx: 3, minHeightPx: 3 }
    }`),
    )
    expect(await generateClient(paths)).not.toBeInstanceOf(Error)
  })

  it('propagates port allocation exhaustion from client generation', async () => {
    const paths = createTempCodegenPaths('ports-exhausted')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), validClientDefinition())
    writeFileSync(paths.portsFile, '{"existing":65535}')
    expect(await generateClient(paths)).toBeInstanceOf(PortAllocationError)
  })

  it('rolls back prior outputs when a later output cannot be committed', () => {
    const root = mkdtempSync(join(tmpdir(), 'atomic-codegen-'))
    const first = join(root, 'first.ts')
    const blocked = join(root, 'blocked.ts')
    writeFileSync(first, 'before')
    mkdirSync(`${blocked}.codegen-${process.pid}-1.tmp`)
    const result = writeGeneratedOutputs([
      { file: first, content: 'after' },
      { file: blocked, content: 'never' },
    ])
    expect(result).toBeInstanceOf(Error)
    expect(readFileSync(first, 'utf8')).toBe('before')
  })

  it('does not replace unchanged outputs', () => {
    const root = mkdtempSync(join(tmpdir(), 'stable-codegen-'))
    const file = join(root, 'stable.ts')
    writeFileSync(file, 'stable')
    const before = fs.statSync(file).mtimeMs
    const rename = vi.spyOn(fs, 'renameSync')
    expect(writeGeneratedOutputs([{ file, content: 'stable' }])).not.toBeInstanceOf(Error)
    expect(rename).not.toHaveBeenCalled()
    expect(fs.statSync(file).mtimeMs).toBe(before)
    rename.mockRestore()
  })

  it('restores committed outputs when a later rename fails', () => {
    const root = mkdtempSync(join(tmpdir(), 'rename-rollback-'))
    const first = join(root, 'first.ts')
    const second = join(root, 'second.ts')
    writeFileSync(first, 'first-before')
    writeFileSync(second, 'second-before')
    const original = fs.renameSync
    const rename = vi.spyOn(fs, 'renameSync')
    rename.mockImplementation((oldPath, newPath) => {
      if (String(oldPath).includes('.tmp') && newPath === second) throw new Error('rename failed')
      return original(oldPath, newPath)
    })
    const result = writeGeneratedOutputs([
      { file: first, content: 'first-after' },
      { file: second, content: 'second-after' },
    ])
    rename.mockRestore()
    expect(result).toBeInstanceOf(Error)
    expect(readFileSync(first, 'utf8')).toBe('first-before')
    expect(readFileSync(second, 'utf8')).toBe('second-before')
  })
})

function createTempCodegenPaths(name: string): CodegenPaths {
  const root = mkdtempSync(join(tmpdir(), `${name}-`))
  const widgetsDir = join(root, 'widgets')
  const widgetDir = join(widgetsDir, 'probe')
  mkdirSync(widgetDir, { recursive: true })
  writeFileSync(join(widgetDir, 'package.json'), '{"name":"widgets-probe"}')
  return {
    widgetsDir,
    portsFile: join(widgetsDir, '.ports.json'),
    clientCatalogFile: join(root, 'widget-catalog.generated.ts'),
    clientIconsFile: join(root, 'widget-icons.generated.ts'),
    serverListFile: join(root, 'widget-server-list.generated.ts'),
    browserListFile: join(root, 'widget-browser-list.generated.ts'),
  }
}

function validClientDefinition() {
  return `export default {
    title: 'Probe', description: 'Probe', defaultSize: { w: 1, h: 1 },
    icon: 'Clock', loadComponent: () => Promise.resolve({ default: () => null })
  }`
}

function clientDefinition(fields: string) {
  return `export default {
    title: 'Probe', description: 'Probe', defaultSize: { w: 1, h: 1 }, icon: 'Clock',
    ${fields}, loadComponent: () => Promise.resolve({ default: () => null })
  }`
}
