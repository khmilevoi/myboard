import fs from 'node:fs'
import path from 'node:path'

import {
  BANNER,
  discoverWidgetDirs,
  uniqueBindings,
  writeGeneratedOutputs,
  type ServerCodegenPaths,
} from './shared'

export function emitServerList(widgetDirs: string[]) {
  const bindings = uniqueBindings(widgetDirs)
  const imports = bindings
    .map(({ dir, identifier }) => `import ${identifier} from '@widgets/${dir}/server'`)
    .join('\n')
  const list = bindings
    .map(
      ({ dir, identifier }) => `  toRuntimeWidgetServerDefinition({
    typeId: ${JSON.stringify(dir)},
    definition: ${identifier},
  })`,
    )
    .join(',\n')
  return `${BANNER}import { toRuntimeWidgetServerDefinition } from '@shared/widgets/contracts'
${imports}

export const widgetServerList = [
${list}
]
`
}

export function emitScopedOwners(input: {
  widgetDirs: string[]
  moduleScopes: Record<string, readonly string[]>
}) {
  const block = (open: string, close: string, lines: string[]) =>
    lines.length === 0 ? open + close : [open, ...lines, '  ' + close].join('\n')
  const widgetTypeIds = block(
    '[',
    ']',
    input.widgetDirs.map((dir) => `    ${JSON.stringify(dir)},`),
  )
  const moduleScopes = block(
    '{',
    '}',
    Object.entries(input.moduleScopes).map(
      ([id, scopes]) => `    ${JSON.stringify(id)}: ${JSON.stringify(scopes)},`,
    ),
  )
  return `${BANNER}export const scopedOwnerList = {
  widgetTypeIds: ${widgetTypeIds},
  moduleScopes: ${moduleScopes},
} as const
`
}

export function prepareServer({
  widgetsDir,
  serverListFile,
  scopedOwnersFile,
}: ServerCodegenPaths) {
  const widgetDirs = discoverWidgetDirs(widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  const existedWidgetDirs = widgetDirs.filter((dir) =>
    fs.existsSync(path.resolve(widgetsDir, dir, 'server.ts')),
  )
  return [
    { file: serverListFile, content: emitServerList(existedWidgetDirs) },
    { file: scopedOwnersFile, content: emitScopedOwners({ widgetDirs, moduleScopes: {} }) },
  ]
}

export function generateServer(paths: ServerCodegenPaths) {
  const outputs = prepareServer(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
