// @vitest-environment node
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  InviteUrlNotFoundError,
  STAND_TARGETS,
  StandLoginArgsError,
  isVirtualCredential,
  parseInviteUrl,
  parseStandLoginArgs,
  standAuthPaths,
} from './model'

describe('parseStandLoginArgs', () => {
  it('accepts the dev and branch stands', () => {
    expect(parseStandLoginArgs(['--env', 'dev'])).toEqual({
      stand: 'dev',
      freshInvite: false,
      headed: false,
    })
    expect(parseStandLoginArgs(['--env=branch', '--fresh-invite', '--headed'])).toEqual({
      stand: 'branch',
      freshInvite: true,
      headed: true,
    })
  })

  it('ignores the bare separator pnpm forwards', () => {
    expect(parseStandLoginArgs(['--', '--env', 'dev'])).toMatchObject({ stand: 'dev' })
  })

  it.each([['production'], ['prod'], ['main'], ['board.iiskelo.com'], ['toString']])(
    'refuses %s',
    (stand) => {
      expect(parseStandLoginArgs(['--env', stand])).toBeInstanceOf(StandLoginArgsError)
    },
  )

  it('requires --env', () => {
    expect(parseStandLoginArgs([])).toBeInstanceOf(StandLoginArgsError)
  })

  it('rejects unknown flags', () => {
    expect(parseStandLoginArgs(['--env', 'dev', '--origin', 'https://x'])).toBeInstanceOf(
      StandLoginArgsError,
    )
  })
})

describe('STAND_TARGETS', () => {
  it('never points at production', () => {
    for (const target of Object.values(STAND_TARGETS)) {
      expect(new URL(target.origin).hostname).not.toBe('board.iiskelo.com')
    }
  })
})

describe('parseInviteUrl', () => {
  const origin = STAND_TARGETS.dev.origin

  it('finds the activation URL among rpi output and the QR code', () => {
    const output = [
      'docker compose exec -T server ...',
      `${origin}/activate?token=abc_DEF-123`,
      '▄▄▄▄▄ ▄ ▄▄▄▄▄',
      "> command 'create-invite' finished (exit 0)",
    ].join('\n')
    expect(parseInviteUrl(output, origin)).toBe(`${origin}/activate?token=abc_DEF-123`)
  })

  it('refuses an invite printed for another host', () => {
    const output = 'https://board.iiskelo.com/activate?token=abc'
    expect(parseInviteUrl(output, origin)).toBeInstanceOf(InviteUrlNotFoundError)
  })

  it('does not treat dots in the origin as wildcards', () => {
    const output = 'https://board-devXiiskelo.com/activate?token=abc'
    expect(parseInviteUrl(output, origin)).toBeInstanceOf(InviteUrlNotFoundError)
  })
})

describe('standAuthPaths', () => {
  it('keeps every file under .auth/stand/<env>', () => {
    const root = resolve('/repo')
    const paths = standAuthPaths(root, 'branch')
    expect(paths.storageState).toBe(resolve(root, '.auth/stand/branch/storage.json'))
    expect(paths.credential).toBe(resolve(root, '.auth/stand/branch/credential.json'))
  })
})

describe('isVirtualCredential', () => {
  it('accepts what WebAuthn.getCredentials returns', () => {
    expect(
      isVirtualCredential({
        credentialId: 'id',
        isResidentCredential: true,
        rpId: 'board-dev.iiskelo.com',
        privateKey: 'key',
        userHandle: 'user',
        signCount: 3,
      }),
    ).toBe(true)
  })

  it.each([[null], [{}], [{ credentialId: 'id', privateKey: 'key' }]])('rejects %j', (value) => {
    expect(isVirtualCredential(value)).toBe(false)
  })
})
