import { resolve } from 'node:path'

import * as errore from 'errore'

/**
 * The only stands an agent may sign itself into. Production is absent on
 * purpose: there is no flag, env or URL override that reaches
 * board.iiskelo.com, so a typo can never mint a device on the real board.
 */
export const STAND_TARGETS = {
  dev: { origin: 'https://board-dev.iiskelo.com', rpiEnv: 'dev' },
  branch: { origin: 'https://board-branch.iiskelo.com', rpiEnv: 'branch' },
} as const

export type StandName = keyof typeof STAND_TARGETS
export type StandTarget = (typeof STAND_TARGETS)[StandName]

export type StandLoginArgs = {
  stand: StandName
  /** Skip the saved session and passkey and register a fresh device from a new invite. */
  freshInvite: boolean
  headed: boolean
}

export class StandLoginArgsError extends errore.createTaggedError({
  name: 'StandLoginArgsError',
  message: '$reason',
}) {}

export class InviteUrlNotFoundError extends errore.createTaggedError({
  name: 'InviteUrlNotFoundError',
  message: 'create-invite printed no activation URL for $origin',
}) {}

function isStandName(value: string): value is StandName {
  return Object.hasOwn(STAND_TARGETS, value)
}

const USAGE = 'usage: stand-login --env <dev|branch> [--fresh-invite] [--headed]'

export function parseStandLoginArgs(argv: readonly string[]): StandLoginArgs | StandLoginArgsError {
  let stand: string | undefined
  let freshInvite = false
  let headed = false

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--env') {
      stand = argv[i + 1]
      i++
    } else if (arg?.startsWith('--env=')) {
      stand = arg.slice('--env='.length)
    } else if (arg === '--fresh-invite') {
      freshInvite = true
    } else if (arg === '--headed') {
      headed = true
    } else if (arg === '--') {
      // pnpm forwards a bare separator into the script; it carries no meaning here.
    } else {
      return new StandLoginArgsError({ reason: `unknown argument ${arg}; ${USAGE}` })
    }
  }

  if (stand === undefined) {
    return new StandLoginArgsError({ reason: `--env is required; ${USAGE}` })
  }
  if (!isStandName(stand)) {
    return new StandLoginArgsError({
      reason: `--env ${stand} is not a stand an agent may sign into (dev, branch); production is never allowed`,
    })
  }

  return { stand, freshInvite, headed }
}

/**
 * Pulls the activation URL out of `rpi command create-invite` output. The
 * URL must sit on the stand's own origin: an invite printed for any other
 * host (a misconfigured PUBLIC_APP_URL, production's default) is refused
 * rather than followed, because WebAuthn would bind the passkey to it.
 */
export function parseInviteUrl(output: string, origin: string): string | InviteUrlNotFoundError {
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`${escaped}/activate\\?token=[A-Za-z0-9_-]+`).exec(output)
  if (match === null) return new InviteUrlNotFoundError({ origin })
  return match[0]
}

export type StandAuthPaths = {
  dir: string
  /** Playwright storage state: the session cookie plus localStorage. */
  storageState: string
  /** The virtual authenticator's exported credential, private key included. */
  credential: string
}

/** Everything lives under the gitignored `.auth/` at the repository root. */
export function standAuthPaths(repoRoot: string, stand: StandName): StandAuthPaths {
  const dir = resolve(repoRoot, '.auth', 'stand', stand)
  return {
    dir,
    storageState: resolve(dir, 'storage.json'),
    credential: resolve(dir, 'credential.json'),
  }
}

/** What `WebAuthn.getCredentials` returns and `WebAuthn.addCredential` accepts. */
export type VirtualCredential = {
  credentialId: string
  isResidentCredential: boolean
  rpId?: string
  privateKey: string
  userHandle?: string
  signCount: number
}

export function isVirtualCredential(value: unknown): value is VirtualCredential {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.credentialId === 'string' &&
    typeof record.isResidentCredential === 'boolean' &&
    typeof record.privateKey === 'string' &&
    typeof record.signCount === 'number'
  )
}

/** The name the activation form gets, so the account is recognisable in list-devices. */
export const AGENT_ACCOUNT_NAME = 'agent'
