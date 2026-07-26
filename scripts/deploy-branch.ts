import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

// Deploys the currently checked-out branch into the `branch` rpi environment
// (rpi.branch.toml), filling its `${BRANCH_NAME}` placeholder from git — so
// nobody retypes the branch name, and nobody deploys the wrong one because they
// forgot to.
//
// Extra arguments are forwarded verbatim, so `pnpm run deploy:branch -- --cancel`
// and `pnpm run deploy:branch -- --server home` work like the bare CLI.

const ENV_NAME = 'branch'
const ENV_FILE = '.env.branch'

// Git ref names permit characters a shell would interpret (`;`, `&`, `$`,
// backticks). We spawn through a shell — see rpi() — so anything outside this
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

// `shell: true` so the rpi shim resolves the same way it would from a terminal,
// regardless of how the current Node version manager installs it (a plain `rpi`
// file, an `rpi.cmd` shim, etc. all vary by setup). The branch name is the only
// non-literal argument and it is validated above.
function rpi(
  branch: string,
  args: string[],
  options: { capture?: boolean } = {},
): { status: number; stdout: string } {
  const result = spawnSync('rpi', [...args, '--env', ENV_NAME, '--vars', `BRANCH_NAME=${branch}`], {
    stdio: options.capture ? ['inherit', 'pipe', 'inherit'] : 'inherit',
    shell: true,
    encoding: 'utf8',
  })
  if (result.error) {
    console.error(result.error)
    return { status: 1, stdout: '' }
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '' }
}

/**
 * rpi keys a project by environment AND variables, so every branch is a brand
 * new project with an empty secrets store. Sending the bundle is therefore not
 * a one-off setup step but part of every first deploy of every branch — and
 * skipping it fails only after the ~3 minute image build, with an opaque
 * "secret file ... does not exist" from Compose. So: detect and send.
 *
 * `rpi secrets ls` exits 0 either way, hence matching on its message.
 */
function ensureSecrets(branch: string): Error | null {
  const listed = rpi(branch, ['secrets', 'ls'], { capture: true })
  if (listed.status !== 0) return new Error('could not read the stored secrets for this branch')
  if (!listed.stdout.includes('no secrets stored')) return null

  if (!existsSync(ENV_FILE)) {
    return new Error(
      `this branch has no secrets on the agent yet and ${ENV_FILE} is missing locally.\n` +
        `  cp .env.branch.example ${ENV_FILE}\n` +
        'then run this command again.',
    )
  }

  console.log(`No secrets stored for this branch yet — sending ${ENV_FILE} and [secrets].files…`)
  const sent = rpi(branch, ['secrets', 'send'])
  if (sent.status !== 0) return new Error('sending the secrets bundle failed; see the output above')

  return null
}

function main(): number {
  const branch = currentBranch()
  if (branch instanceof Error) {
    console.error(branch.message)
    return 1
  }

  // `pnpm run deploy:branch -- --cancel` forwards the separator itself, and
  // rpi's parser reads a bare `--` as end-of-flags, so the flag after it lands
  // as a positional and is rejected. Both spellings should work.
  const passthrough = process.argv.slice(2).filter((argument) => argument !== '--')

  // --cancel aborts an in-flight deploy; it neither needs nor should trigger a
  // secrets round-trip.
  if (!passthrough.includes('--cancel')) {
    const secretsProblem = ensureSecrets(branch)
    if (secretsProblem) {
      console.error(secretsProblem.message)
      return 1
    }
  }

  console.log(`Deploying ${branch} to the \`${ENV_NAME}\` environment…`)
  return rpi(branch, ['deploy', ...passthrough]).status
}

process.exit(main())
