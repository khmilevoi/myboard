import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// Deploys the currently checked-out branch into the `branch` rpi environment
// (rpi.branch.toml), filling its `${BRANCH_NAME}` placeholder from git — so
// nobody retypes the branch name, and nobody deploys the wrong one because they
// forgot to.
//
// Extra arguments are forwarded verbatim, so `pnpm deploy:branch -- --cancel`
// and `pnpm deploy:branch -- --server home` work like the bare CLI.

const ENV_NAME = 'branch'
const ENV_FILE = '.env.branch'

// Git ref names permit characters a shell would interpret (`;`, `&`, `$`,
// backticks). We spawn through a shell — see runRpi — so anything outside this
// conservative set is refused rather than escaped: the branch naming convention
// in CLAUDE.md is feat/ fix/ chore/, all of which fit.
const SAFE_BRANCH = /^[A-Za-z0-9._/-]+$/

function currentBranch(): Error | string {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' })
  if (result.error) return result.error
  if (result.status !== 0) return new Error(result.stderr.trim() || 'git rev-parse failed')

  const branch = result.stdout.trim()
  if (branch === 'HEAD') {
    return new Error(
      'HEAD is detached, so there is no branch to deploy. Check out a branch, or run `rpi deploy --env branch --vars BRANCH_NAME=<branch>` yourself.',
    )
  }
  if (!SAFE_BRANCH.test(branch)) {
    return new Error(
      `branch name ${JSON.stringify(branch)} contains characters this script refuses to pass to a shell`,
    )
  }

  return branch
}

/**
 * Secrets are sent by a separate command, so a missing bundle does not fail the
 * deploy — it produces a stack whose WebAuthn gate rejects every ceremony with
 * nothing in the deploy log to explain why. Catching it here is one readable
 * message instead of that.
 */
function missingSecrets(branch: string): Error | null {
  if (existsSync(ENV_FILE)) return null

  return new Error(
    `${ENV_FILE} is missing, so this stack would come up without its WebAuthn settings.\n` +
      `  cp .env.branch.example ${ENV_FILE}\n` +
      `  rpi secrets send --env ${ENV_NAME} --vars BRANCH_NAME=${branch}`,
  )
}

// `shell: true` so the rpi shim resolves the same way it would from a terminal,
// regardless of how the current Node version manager installs it (a plain `rpi`
// file, an `rpi.cmd` shim, etc. all vary by setup). The branch name is the only
// non-literal argument and it is validated above.
function runRpi(branch: string, passthrough: string[]): number {
  const result = spawnSync(
    'rpi',
    ['deploy', '--env', ENV_NAME, '--vars', `BRANCH_NAME=${branch}`, ...passthrough],
    { stdio: 'inherit', shell: true },
  )
  if (result.error) {
    console.error(result.error)
    return 1
  }
  return result.status ?? 1
}

function main(): number {
  const branch = currentBranch()
  if (branch instanceof Error) {
    console.error(branch.message)
    return 1
  }

  const secretsProblem = missingSecrets(branch)
  if (secretsProblem) {
    console.error(secretsProblem.message)
    return 1
  }

  console.log(`Deploying ${branch} to the \`${ENV_NAME}\` environment…`)
  return runRpi(branch, process.argv.slice(2))
}

process.exit(main())
