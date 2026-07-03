import fs from 'node:fs'
import path from 'node:path'

import {
  BANNER,
  discoverWidgetDirs,
  uniqueBindings,
  writeGeneratedOutputs,
  type BrowserCodegenPaths,
} from './shared'

export function emitBrowserList(widgetDirs: string[]) {
  if (widgetDirs.length === 0) {
    return `${BANNER}export const widgetBrowserList = [
]
`
  }
  const bindings = uniqueBindings(widgetDirs)
  const imports = bindings
    .map(({ dir, identifier }) => `import ${identifier} from '@widgets/${dir}/browser'`)
    .join('\n')
  const list = bindings
    .map(
      ({ dir, identifier }) => `  toRuntimeWidgetBrowserDefinition({
    widgetId: ${JSON.stringify(dir)},
    definition: ${identifier},
  })`,
    )
    .join(',\n')
  return `${BANNER}import { toRuntimeWidgetBrowserDefinition } from '@shared/widgets/browser-contracts'
${imports}

export const widgetBrowserList = [
${list}
]
`
}

export function prepareBrowser({ widgetsDir, browserListFile }: BrowserCodegenPaths) {
  const widgetDirs = discoverWidgetDirs(widgetsDir)
  if (widgetDirs instanceof Error) return widgetDirs
  const browserWidgetDirs = widgetDirs.filter((dir) =>
    fs.existsSync(path.resolve(widgetsDir, dir, 'browser.ts')),
  )
  return [{ file: browserListFile, content: emitBrowserList(browserWidgetDirs) }]
}

export function generateBrowser(paths: BrowserCodegenPaths) {
  const outputs = prepareBrowser(paths)
  if (outputs instanceof Error) return outputs
  return writeGeneratedOutputs(outputs)
}
