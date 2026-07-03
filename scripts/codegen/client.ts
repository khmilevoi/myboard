import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as errore from 'errore'

import {
  assignPorts,
  BANNER,
  CodegenIoError,
  discoverWidgetDirs,
  MissingWidgetEntrypointError,
  InvalidPortsConfigError,
  stableJson,
  writeGeneratedOutputs,
  type ClientCodegenPaths,
  type GeneratedOutput,
} from './shared'

type WidgetClientLike = {
  title: string
  description: string
  defaultSize: { w: number; h: number; minW?: number; minH?: number }
  tiers?: unknown
  icon: string
  loadComponent: unknown
}
export type WidgetMeta = Omit<WidgetClientLike, 'loadComponent'> & { dir: string }

export class WidgetClientImportError extends errore.createTaggedError({
  name: 'WidgetClientImportError',
  message: 'Failed to import client definition for widget $widgetId',
}) {}
export class InvalidWidgetClientDefinitionError extends errore.createTaggedError({
  name: 'InvalidWidgetClientDefinitionError',
  message: 'Invalid client definition for widget $widgetId',
}) {}

export function emitCatalog(metas: WidgetMeta[]) {
  const entries = metas
    .map(
      (meta) => `  toWidgetType({
    id: ${JSON.stringify(meta.dir)},
    title: ${JSON.stringify(meta.title)},
    description: ${JSON.stringify(meta.description)},
    defaultSize: ${stableJson(meta.defaultSize).replace(/\n/g, '\n    ')},
    icon: ${JSON.stringify(meta.icon)},${meta.tiers ? `\n    tiers: ${stableJson(meta.tiers).replace(/\n/g, '\n    ')},` : ''}
    loadComponent: loadRemoteModule(${JSON.stringify(meta.dir)}),
  })`,
    )
    .join(',\n')
  return `${BANNER}import { loadRemote } from '@module-federation/runtime'
import { toWidgetType, type WidgetClientDefinition, type WidgetType } from 'widget-sdk/define-widget-client'

import type { WidgetIconName } from './widget-icons.generated'

async function loadRemoteModule(id: string) {
  const module = await loadRemote<
    WidgetClientDefinition | { default: WidgetClientDefinition }
  >(\`\${id}/client\`)
  const definition =
    module && typeof module === 'object' && 'default' in module ? module.default : module
  if (!definition) throw new Error(\`Remote widget \${id}/client returned no definition\`)
  return definition.loadComponent()
}

export const widgetTypes = [
${entries}
] as (WidgetType & { icon: WidgetIconName })[]
`
}

export function emitIcons(metas: WidgetMeta[]) {
  const icons = [...new Set(metas.map((meta) => meta.icon))].sort((a, b) => a.localeCompare(b))
  if (icons.length === 0) {
    return `${BANNER}import type { LucideIcon } from 'lucide-react'

export type WidgetIconName = never

export const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = {}
`
  }
  return `${BANNER}import type { LucideIcon } from 'lucide-react'
import { ${icons.join(', ')} } from 'lucide-react'

export type WidgetIconName = ${icons.map((icon) => `'${icon}'`).join(' | ')}

export const WIDGET_ICONS: Record<WidgetIconName, LucideIcon> = { ${icons.join(', ')} }
`
}

export async function prepareClient(paths: ClientCodegenPaths): Promise<Error | GeneratedOutput[]> {
  const widgetDirs = discoverWidgetDirs(paths.widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  const portsText = fs.existsSync(paths.portsFile)
    ? errore.try(() => fs.readFileSync(paths.portsFile, 'utf8'))
    : '{}'
  if (portsText instanceof Error) {
    return new CodegenIoError({ operation: 'read', path: paths.portsFile, cause: portsText })
  }
  const currentPorts = errore.try(() => JSON.parse(portsText) as Record<string, number>)
  if (currentPorts instanceof Error) {
    return new CodegenIoError({ operation: 'parse', path: paths.portsFile, cause: currentPorts })
  }
  if (!isPortsConfig(currentPorts)) return new InvalidPortsConfigError({ path: paths.portsFile })
  const metas: WidgetMeta[] = []
  for (const dir of widgetDirs) {
    const entrypoint = path.resolve(paths.widgetsDir, dir, 'client.ts')
    if (!fs.existsSync(entrypoint)) {
      return new MissingWidgetEntrypointError({ side: 'client', widgetId: dir, path: entrypoint })
    }
    const imported = await import(pathToFileURL(entrypoint).href).catch(
      (cause) => new WidgetClientImportError({ widgetId: dir, cause }),
    )
    if (imported instanceof Error) return imported
    const definition: unknown = imported.default
    if (!isWidgetClientLike(definition)) {
      return new InvalidWidgetClientDefinitionError({ widgetId: dir })
    }
    metas.push({
      dir,
      title: definition.title,
      description: definition.description,
      defaultSize: definition.defaultSize,
      tiers: definition.tiers,
      icon: definition.icon,
    })
  }
  return [
    { file: paths.portsFile, content: `${stableJson(assignPorts(widgetDirs, currentPorts))}\n` },
    { file: paths.clientCatalogFile, content: emitCatalog(metas) },
    { file: paths.clientIconsFile, content: emitIcons(metas) },
  ]
}

function isPortsConfig(value: unknown): value is Record<string, number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value).every(
    (port) => typeof port === 'number' && Number.isFinite(port) && Number.isInteger(port),
  )
}

function isWidgetClientLike(value: unknown): value is WidgetClientLike {
  if (value === null || typeof value !== 'object') return false
  const definition = value as Record<string, unknown>
  const size = definition.defaultSize
  if (size === null || typeof size !== 'object') return false
  const dimensions = size as Record<string, unknown>
  return (
    typeof definition.title === 'string' &&
    typeof definition.description === 'string' &&
    typeof definition.icon === 'string' &&
    typeof definition.loadComponent === 'function' &&
    typeof dimensions.w === 'number' &&
    Number.isFinite(dimensions.w) &&
    typeof dimensions.h === 'number' &&
    Number.isFinite(dimensions.h)
  )
}

export async function generateClient(paths: ClientCodegenPaths): Promise<Error | void> {
  const outputs = await prepareClient(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
