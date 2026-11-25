import { generateBrowser, prepareBrowser } from './codegen/browser'
import { generateClient, prepareClient } from './codegen/client'
import { generateModules, prepareModules } from './codegen/modules'
import { generateServer, prepareServer } from './codegen/server'
import {
  defaultCodegenPaths,
  parseCodegenTarget,
  writeGeneratedOutputs,
  type CodegenTarget,
} from './codegen/shared'

async function run(target: CodegenTarget) {
  if (target === 'client') return generateClient(defaultCodegenPaths)
  if (target === 'server') return generateServer(defaultCodegenPaths)
  if (target === 'browser') return generateBrowser(defaultCodegenPaths)
  if (target === 'modules') {
    const modules = await generateModules(defaultCodegenPaths)
    return modules instanceof Error ? modules : undefined
  }

  const prepared = await prepareModules(defaultCodegenPaths)
  if (prepared instanceof Error) return prepared
  const modulesWritten = writeGeneratedOutputs(prepared.outputs)
  if (modulesWritten instanceof Error) return modulesWritten
  const clientOutputs = await prepareClient(defaultCodegenPaths, prepared.modules)
  if (clientOutputs instanceof Error) return clientOutputs
  const serverOutputs = prepareServer(defaultCodegenPaths, prepared.modules)
  if (serverOutputs instanceof Error) return serverOutputs
  const browserOutputs = prepareBrowser(defaultCodegenPaths)
  if (browserOutputs instanceof Error) return browserOutputs
  return writeGeneratedOutputs([...clientOutputs, ...serverOutputs, ...browserOutputs])
}

async function main() {
  const target = parseCodegenTarget(process.argv[2] ?? 'all')
  const result = target instanceof Error ? target : await run(target)
  if (result instanceof Error) {
    console.error(result)
    process.exitCode = 1
  }
}

void main()
