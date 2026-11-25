import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import * as errore from 'errore'

import {
  BANNER,
  CodegenIoError,
  discoverWidgetDirs,
  identifierFromDirectory,
  uniqueBindings,
  writeGeneratedOutputs,
  type GeneratedOutput,
  type ModulesCodegenPaths,
} from './shared'

// Mirrors ModuleScope in packages/shared/modules/contracts.ts (scripts cannot use the alias).
export type ModuleScope = 'shared' | 'account'

export type ModuleMeta = {
  dir: string
  scopes: ModuleScope[]
  hasServer: boolean
  packageName: string
  version: string
}

export class InvalidModuleDefinitionError extends errore.createTaggedError({
  name: 'InvalidModuleDefinitionError',
  message: 'Invalid module definition for module $moduleId',
}) {}
export class InvalidModulePackageError extends errore.createTaggedError({
  name: 'InvalidModulePackageError',
  message: 'Module $moduleId must be named module-$moduleId in its package.json',
}) {}
export class UnknownModuleReferenceError extends errore.createTaggedError({
  name: 'UnknownModuleReferenceError',
  message: 'Widget $widgetId references unknown module $moduleId',
}) {}
export class ReservedWidgetNameError extends errore.createTaggedError({
  name: 'ReservedWidgetNameError',
  message: 'Widget directory name $widgetId is reserved',
}) {}

const RESERVED_WIDGET_NAMES = new Set(['module'])
const MODULE_SCOPES: readonly string[] = ['shared', 'account']

function singleQuoted(value: string) {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function emitModuleBinding(dir: string) {
  return `${BANNER}import { bindModule } from 'widget-runtime/define-module'

import definition from '../module'

export const ${identifierFromDirectory(dir)}Module = bindModule(${singleQuoted(dir)}, definition)
`
}

export function emitModulePackages(modules: ModuleMeta[]) {
  const entries = modules
    .map((meta) => `  ${singleQuoted(meta.packageName)}: ${singleQuoted(meta.version)},`)
    .join('\n')
  return `${BANNER}export const modulePackages: Record<string, string> = {${entries === '' ? '' : `\n${entries}\n`}}
`
}

export function emitModuleServerList(modules: ModuleMeta[]) {
  const serverDirs = modules.filter((meta) => meta.hasServer).map((meta) => meta.dir)
  if (serverDirs.length === 0) {
    return `${BANNER}export const moduleServerList = [
]
`
  }
  const bindings = uniqueBindings(serverDirs)
  const imports = bindings
    .map(({ dir, identifier }) => `import ${identifier} from '@modules/${dir}/server'`)
    .join('\n')
  const list = bindings
    .map(
      ({ dir, identifier }) => `  toRuntimeModuleServerDefinition({
    moduleId: ${JSON.stringify(dir)},
    definition: ${identifier},
  })`,
    )
    .join(',\n')
  return `${BANNER}import { toRuntimeModuleServerDefinition } from '@shared/modules/contracts'
${imports}

export const moduleServerList = [
${list}
]
`
}

function readModulePackage(dir: string, packageFile: string) {
  const text = errore.try(() => fs.readFileSync(packageFile, 'utf8'))
  if (text instanceof Error) {
    return new CodegenIoError({ operation: 'read', path: packageFile, cause: text })
  }
  const parsed = errore.try(() => JSON.parse(text) as { name?: unknown; version?: unknown })
  if (parsed instanceof Error) {
    return new CodegenIoError({ operation: 'parse', path: packageFile, cause: parsed })
  }
  if (parsed?.name !== `module-${dir}`) return new InvalidModulePackageError({ moduleId: dir })
  const version = typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  return { packageName: parsed.name, version }
}

function extractScopes(value: unknown, dir: string) {
  if (value === null || typeof value !== 'object') {
    return new InvalidModuleDefinitionError({ moduleId: dir })
  }
  const definition = value as Record<string, unknown>
  const scopes = definition.scopes
  const actions = definition.actions
  const loadModel = definition.loadModel
  if (!Array.isArray(scopes) || scopes.length === 0) {
    return new InvalidModuleDefinitionError({ moduleId: dir })
  }
  if (!scopes.every((scope) => typeof scope === 'string' && MODULE_SCOPES.includes(scope))) {
    return new InvalidModuleDefinitionError({ moduleId: dir })
  }
  if (new Set(scopes).size !== scopes.length) {
    return new InvalidModuleDefinitionError({ moduleId: dir })
  }
  if (actions === null || typeof actions !== 'object' || Array.isArray(actions)) {
    return new InvalidModuleDefinitionError({ moduleId: dir })
  }
  if (loadModel !== undefined && typeof loadModel !== 'function') {
    return new InvalidModuleDefinitionError({ moduleId: dir })
  }
  return scopes as ModuleScope[]
}

export async function prepareModules(
  paths: ModulesCodegenPaths,
): Promise<Error | { outputs: GeneratedOutput[]; modules: ModuleMeta[] }> {
  const widgetDirs = discoverWidgetDirs(paths.widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  const reserved = widgetDirs.find((dir) => RESERVED_WIDGET_NAMES.has(dir))
  if (reserved !== undefined) return new ReservedWidgetNameError({ widgetId: reserved })

  const moduleDirs = fs.existsSync(paths.modulesDir) ? discoverWidgetDirs(paths.modulesDir) : []
  if (moduleDirs instanceof Error) return moduleDirs

  const modules: ModuleMeta[] = []
  const outputs: GeneratedOutput[] = []
  for (const dir of moduleDirs) {
    const moduleDir = path.resolve(paths.modulesDir, dir)
    const pkg = readModulePackage(dir, path.resolve(moduleDir, 'package.json'))
    if (pkg instanceof Error) return pkg
    const entrypoint = path.resolve(moduleDir, 'module.ts')
    if (!fs.existsSync(entrypoint)) return new InvalidModuleDefinitionError({ moduleId: dir })
    const imported = await import(pathToFileURL(entrypoint).href).catch(
      (cause) => new InvalidModuleDefinitionError({ moduleId: dir, cause }),
    )
    if (imported instanceof Error) return imported
    const scopes = extractScopes(imported.default, dir)
    if (scopes instanceof Error) return scopes
    modules.push({
      dir,
      scopes,
      hasServer: fs.existsSync(path.resolve(moduleDir, 'server.ts')),
      packageName: pkg.packageName,
      version: pkg.version,
    })
    outputs.push({
      file: path.resolve(moduleDir, 'generated/module.ts'),
      content: emitModuleBinding(dir),
    })
  }
  outputs.push(
    { file: paths.modulePackagesFile, content: emitModulePackages(modules) },
    { file: paths.moduleServerListFile, content: emitModuleServerList(modules) },
  )
  return { outputs, modules }
}

export async function generateModules(paths: ModulesCodegenPaths): Promise<Error | ModuleMeta[]> {
  const prepared = await prepareModules(paths)
  if (prepared instanceof Error) return prepared
  const written = writeGeneratedOutputs(prepared.outputs)
  if (written instanceof Error) return written
  return prepared.modules
}
