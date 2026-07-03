import { generateClient, prepareClient } from './codegen/client'
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
  const clientOutputs = await prepareClient(defaultCodegenPaths)
  if (clientOutputs instanceof Error) return clientOutputs
  const serverOutputs = prepareServer(defaultCodegenPaths)
  if (serverOutputs instanceof Error) return serverOutputs
  return writeGeneratedOutputs([...clientOutputs, ...serverOutputs])
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
