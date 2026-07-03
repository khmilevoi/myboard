import fs from 'node:fs'
import path from 'node:path'

import {
  BANNER,
  discoverWidgetDirs,
  identifierFromDirectory,
  MissingWidgetEntrypointError,
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

function uniqueBindings(widgetDirs: string[]) {
  const counts = new Map<string, number>()
  return widgetDirs.map((dir) => {
    const base = identifierFromDirectory(dir)
    const count = (counts.get(base) ?? 0) + 1
    counts.set(base, count)
    return { dir, identifier: count === 1 ? base : `${base}$${count}` }
  })
}

export function prepareServer({ widgetsDir, serverListFile }: ServerCodegenPaths) {
  const widgetDirs = discoverWidgetDirs(widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  for (const dir of widgetDirs) {
    const entrypoint = path.resolve(widgetsDir, dir, 'server.ts')
    if (!fs.existsSync(entrypoint)) {
      return new MissingWidgetEntrypointError({ side: 'server', widgetId: dir, path: entrypoint })
    }
  }
  return [{ file: serverListFile, content: emitServerList(widgetDirs) }]
}

export function generateServer(paths: ServerCodegenPaths) {
  const outputs = prepareServer(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
