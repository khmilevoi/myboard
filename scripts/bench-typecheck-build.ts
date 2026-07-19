import { execSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(REPO_ROOT, 'docs/typescript-7-migration')
const RESULTS_FILE = resolve(RESULTS_DIR, 'benchmarks.json')
const LOG_FILE = resolve(RESULTS_DIR, 'bench.log')

function log(message: string): void {
  const line = `[${new Date().toISOString()}] ${message}`
  console.log(line)
  mkdirSync(RESULTS_DIR, { recursive: true })
  appendFileSync(LOG_FILE, `${line}\n`)
}

const TYPECHECK_CACHE_FILES = [
  resolve(REPO_ROOT, 'packages/client/node_modules/.cache/tsconfig.tsbuildinfo'),
  resolve(REPO_ROOT, 'packages/client/node_modules/.cache/tsconfig.node.tsbuildinfo'),
]

interface Args {
  phase: 'before' | 'after'
  typecheckRuns: number
  buildRuns: number
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const phaseArg = args.find((a) => a.startsWith('--phase='))?.split('=')[1]
  if (phaseArg !== 'before' && phaseArg !== 'after') {
    throw new Error(
      'Usage: tsx scripts/bench-typecheck-build.ts --phase=before|after [--typecheck-runs=N] [--build-runs=N]',
    )
  }
  const typecheckRuns = Number(args.find((a) => a.startsWith('--typecheck-runs='))?.split('=')[1] ?? 3)
  const buildRuns = Number(args.find((a) => a.startsWith('--build-runs='))?.split('=')[1] ?? 2)
  return { phase: phaseArg, typecheckRuns, buildRuns }
}

function clearTypecheckCache(): void {
  for (const file of TYPECHECK_CACHE_FILES) {
    if (existsSync(file)) rmSync(file)
  }
}

function timeCommand(label: string, command: string): number {
  log(`START ${label}: ${command}`)
  const start = process.hrtime.bigint()
  try {
    execSync(command, { cwd: REPO_ROOT, stdio: 'inherit' })
  } catch (error) {
    log(`FAILED ${label}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  const end = process.hrtime.bigint()
  const seconds = Number(end - start) / 1e9
  log(`DONE  ${label}: ${seconds.toFixed(2)}s`)
  return seconds
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function typescriptVersion(): string {
  return execSync(
    'pnpm --filter client exec node -p "require(\'typescript/package.json\').version"',
    { cwd: REPO_ROOT, encoding: 'utf-8' },
  ).trim()
}

function main(): void {
  const { phase, typecheckRuns, buildRuns } = parseArgs()
  const tsVersion = typescriptVersion()

  log(`=== Benchmarking phase: ${phase} ===`)
  log(`TypeScript version: ${tsVersion}`)
  log(`Node version: ${process.version}`)
  log(`Plan: 1 cold typecheck + ${typecheckRuns - 1} warm typecheck run(s), then ${buildRuns} build run(s)`)

  clearTypecheckCache()
  const typecheckCold = timeCommand('typecheck cold', 'pnpm run typecheck')

  const typecheckWarm: number[] = []
  for (let i = 1; i < typecheckRuns; i++) {
    typecheckWarm.push(timeCommand(`typecheck warm ${i}/${typecheckRuns - 1}`, 'pnpm run typecheck'))
  }

  const buildRunsSeconds: number[] = []
  for (let i = 1; i <= buildRuns; i++) {
    buildRunsSeconds.push(timeCommand(`build ${i}/${buildRuns}`, 'pnpm run build'))
  }

  const results = {
    typescript: tsVersion,
    node: process.version,
    typecheck: {
      coldSeconds: typecheckCold,
      warmRunsSeconds: typecheckWarm,
      warmMedianSeconds: typecheckWarm.length > 0 ? median(typecheckWarm) : null,
    },
    build: {
      runsSeconds: buildRunsSeconds,
      medianSeconds: median(buildRunsSeconds),
    },
  }

  mkdirSync(RESULTS_DIR, { recursive: true })
  const existing: Record<string, unknown> = existsSync(RESULTS_FILE)
    ? JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'))
    : {}
  existing[phase] = results
  writeFileSync(RESULTS_FILE, `${JSON.stringify(existing, null, 2)}\n`)

  log(`Saved ${phase} results to ${RESULTS_FILE}`)
  log(JSON.stringify(results, null, 2))
}

main()
