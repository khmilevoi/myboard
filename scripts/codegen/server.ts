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

export function prepareServer({ widgetsDir, serverListFile }: ServerCodegenPaths) {
  const widgetDirs = discoverWidgetDirs(widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  const existedWidgetDirs = widgetDirs.filter((dir) =>
    fs.existsSync(path.resolve(widgetsDir, dir, 'server.ts')),
  )
  return [{ file: serverListFile, content: emitServerList(existedWidgetDirs) }]
}

export function generateServer(paths: ServerCodegenPaths) {
  const outputs = prepareServer(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
