import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
    expect(out).toContain('typeId: "clock"')
    expect(out).toContain('definition: clock')
  })

  it('keeps existing ports and appends max+1 for new widgets', () => {
    expect(assignPorts(['clock', 'ofelia-poop-duty'], {})).toEqual({
      clock: 5180,
      'ofelia-poop-duty': 5181,
    })
    expect(assignPorts(['aa', 'clock'], { clock: 5180 })).toEqual({ clock: 5180, aa: 5181 })
  })

  it('parses supported targets and rejects unknown targets', () => {
    expect(parseCodegenTarget('invalid')).toBeInstanceOf(InvalidCodegenTargetError)
    expect(parseCodegenTarget('server')).toBe('server')
  })

  it('creates legal, reserved-safe, collision-safe bindings', () => {
    const directories = ['1-clock', 'with.dot', 'class', 'widget$31']
    const identifiers = directories.map(identifierFromDirectory)
    expect(identifiers.every((identifier) => /^[A-Za-z_$][\w$]*$/.test(identifier))).toBe(true)
    expect(identifiers).toHaveLength(new Set(identifiers).size)
    expect(identifiers).not.toContain('class')
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

  it('fails server codegen when server.ts is missing', () => {
    const paths = createTempCodegenPaths('missing-server')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), 'export default {}')
    expect(generateServer(paths)).toBeInstanceOf(MissingWidgetEntrypointError)
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

  it('returns a tagged error for malformed client definitions', async () => {
    const paths = createTempCodegenPaths('invalid-client')
    writeFileSync(join(paths.widgetsDir, 'probe', 'client.ts'), 'export default { title: 42 }')
    expect(await generateClient(paths)).toBeInstanceOf(InvalidWidgetClientDefinitionError)
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
  }
}

function validClientDefinition() {
  return `export default {
    title: 'Probe', description: 'Probe', defaultSize: { w: 1, h: 1 },
    icon: 'Clock', loadComponent: () => Promise.resolve({ default: () => null })
  }`
}
