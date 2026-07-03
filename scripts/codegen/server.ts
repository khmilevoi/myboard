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
  const imports = widgetDirs
    .map((dir) => `import ${identifierFromDirectory(dir)} from '@widgets/${dir}/server'`)
    .join('\n')
  const list = widgetDirs
    .map(
      (dir) => `  toRuntimeWidgetServerDefinition({
    typeId: ${JSON.stringify(dir)},
    definition: ${identifierFromDirectory(dir)},
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
