# Invite/Device Admin CLI Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add three admin CLI commands — `prune-invites`, `revoke-devices --account <id>` — and an ASCII QR code in `create-invite`'s output, following the existing `packages/server/scripts/` conventions.

**Architecture:** `prune-invites` gets a reusable `pruneInvites()` primitive in `src/auth/invites.ts` (alongside the existing `revokeInviteById`/`listAllInvites` ops-script helpers), wrapped by a thin `scripts/prune-invites.ts` CLI. `revoke-devices` composes existing primitives (`getAccount`, `listAccountDeviceIds`, `revokeDevice`) directly inside `scripts/revoke-devices.ts`, mirroring how `scripts/revoke-account.ts` is built — no new `src/auth/devices.ts` export needed. The QR code is a one-line addition to `create-invite.ts`'s CLI entry point using the `qrcode-terminal` package, printed to stderr so stdout keeps emitting exactly the invite URL.

**Tech Stack:** TypeScript, Vitest, errore (errors-as-values), Zod, iovalkey (Redis-compatible), rspack (bundling scripts as separate `.cjs` entries), `qrcode-terminal` (new dependency).

## Global Constraints

- No throwing — every fallible function returns `T | SomeError` per the errore pattern already used throughout `packages/server/src/auth`.
- Every new script follows the existing 3-file pattern: `<name>.ts` (logic + `run<Name>`/`run<Name>Cli`), `<name>.cli.ts` (`void run<Name>Cli()`), `<name>.test.ts` (Vitest, using `createMemoryOps`/`createMemoryPubSub` from `../src/test/memory-ops`).
- Every new script needs a matching entry in `packages/server/rspack.config.ts`'s `entry` map, named `scripts/<name>`.
- `create-invite`'s stdout must remain byte-for-byte just the invite URL followed by a newline — nothing else may go to stdout (existing integration test `create-invite.entry.integration.test.ts` asserts `stdout` matches `/\/activate\?token=.+/`, and any external tooling piping this command's stdout depends on it staying exactly the URL).
- `pruneInvites` deletes invites in status `expired`, `consumed`, or `locked`; `active` invites are never touched.
- `revoke-devices` must not delete the account record or its `account:<id>:devices` key structure — only the individual devices and their sessions (via the existing `revokeDevice`).
- Both new commands support `--dry-run`, which performs the same read-side computation but skips every delete/revoke call.
- Run `pnpm --filter server exec vitest run <file>` to run a single test file; run `pnpm --filter server test` for the full server suite.

---

### Task 1: `pruneInvites` core function + tests

**Files:**
- Modify: `packages/server/src/auth/invites.ts` (add `pruneInvites`, exported `InvitePruneResult` type, after the existing `listAllInvites` function at the end of the file)
- Test: `packages/server/src/auth/invites.test.ts` (add a new `describe('pruneInvites', ...)` block at the end)

**Interfaces:**
- Consumes: `InviteStatus`, `inviteStatus()`, `INVITE_KEY_PREFIX`, `getJson()`, `InviteRecordSchema` — all already defined earlier in `invites.ts`. `ValkeyOps` from `../storage/valkey`.
- Produces: `export type InvitePruneResult = { pruned: Array<{ id: string; status: InviteStatus }>; kept: number }` and `export async function pruneInvites(ops: ValkeyOps, now: () => number, opts?: { dryRun?: boolean }): Promise<InvitePruneResult>` — consumed by Task 2's `scripts/prune-invites.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/server/src/auth/invites.test.ts` (add `pruneInvites` to the existing import from `./invites` at the top of the file, changing:
```ts
import {
  consumeInvite,
  createInvite,
  lookupInvite,
  recordInviteFailure,
  releaseInvite,
  revokeInviteById,
} from './invites'
```
to:
```ts
import {
  consumeInvite,
  createInvite,
  lookupInvite,
  pruneInvites,
  recordInviteFailure,
  releaseInvite,
  revokeInviteById,
} from './invites'
```
), then add at the end of the file:

```ts
describe('pruneInvites', () => {
  it('deletes expired, consumed, and locked invites but keeps active ones', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)

    const { record: activeRecord } = await createInvite(ops, clock.now, { ttlMs: 60_000 })

    const { token: consumedToken, record: consumedRecord } = await createInvite(ops, clock.now, {
      ttlMs: 60_000,
      maxUses: 1,
    })
    await consumeInvite(ops, clock.now, consumedToken)

    const { token: lockedToken, record: lockedRecord } = await createInvite(ops, clock.now, {
      ttlMs: 60_000,
    })
    for (let i = 0; i < 10; i++) {
      await recordInviteFailure(ops, clock.now, lockedToken)
    }

    // ttlMs 1_000 means expiresAt = 2_000; the fake store never purges on its
    // own TTL (see the recordInviteFailure tests above), so this stays present
    // past its application-level expiry for pruneInvites to find.
    const { record: expiredRecord } = await createInvite(ops, clock.now, { ttlMs: 1_000 })

    clock.set(5_000)
    const result = await pruneInvites(ops, clock.now)

    const prunedIds = result.pruned.map((p) => p.id).sort()
    expect(prunedIds).toEqual([consumedRecord.id, expiredRecord.id, lockedRecord.id].sort())
    expect(result.pruned.find((p) => p.id === consumedRecord.id)?.status).toBe('consumed')
    expect(result.pruned.find((p) => p.id === lockedRecord.id)?.status).toBe('locked')
    expect(result.pruned.find((p) => p.id === expiredRecord.id)?.status).toBe('expired')
    expect(result.kept).toBe(1)

    expect(await lookupInvite(ops, clock.now, consumedToken)).toBeInstanceOf(Error)
    expect(await lookupInvite(ops, clock.now, lockedToken)).toBeInstanceOf(Error)
    const remaining = await ops.scanKeys('invite:')
    expect(remaining).toHaveLength(1)
    void activeRecord
  })

  it('dry-run reports prunable invites without deleting them', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    const { token, record } = await createInvite(ops, clock.now, { ttlMs: 60_000, maxUses: 1 })
    await consumeInvite(ops, clock.now, token)

    const result = await pruneInvites(ops, clock.now, { dryRun: true })

    expect(result).toEqual({ pruned: [{ id: record.id, status: 'consumed' }], kept: 0 })
    const remaining = await ops.scanKeys('invite:')
    expect(remaining).toHaveLength(1)
  })

  it('returns an empty prune list and correct kept count on an all-active store', async () => {
    const ops = makeOps()
    const clock = makeClock(1_000)
    await createInvite(ops, clock.now, { ttlMs: 60_000 })
    await createInvite(ops, clock.now, { ttlMs: 60_000 })

    const result = await pruneInvites(ops, clock.now)

    expect(result).toEqual({ pruned: [], kept: 2 })
  })
})
```

(`void activeRecord` silences the unused-variable lint on `activeRecord`, which is intentionally never referenced beyond confirming — via its absence from `result.pruned` — that active invites are left alone.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server exec vitest run src/auth/invites.test.ts`
Expected: FAIL — `pruneInvites` is not exported from `./invites`.

- [ ] **Step 3: Implement `pruneInvites`**

Append to `packages/server/src/auth/invites.ts` (after the existing `listAllInvites` function, i.e. at the very end of the file):

```ts
export type InvitePruneResult = {
  pruned: Array<{ id: string; status: InviteStatus }>
  kept: number
}

/** Ops-script path: deletes invites whose status is no longer 'active'. */
export async function pruneInvites(
  ops: ValkeyOps,
  now: () => number,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<InvitePruneResult> {
  const keys = await ops.scanKeys(INVITE_KEY_PREFIX)
  const pruned: Array<{ id: string; status: InviteStatus }> = []
  let kept = 0

  for (const key of keys) {
    const record = await getJson(ops, key, InviteRecordSchema)
    if (record instanceof Error || record === null) continue

    const status = inviteStatus(record, now)
    if (status === 'active') {
      kept++
      continue
    }

    pruned.push({ id: record.id, status })
    if (!dryRun) await ops.del(key)
  }

  return { pruned, kept }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter server exec vitest run src/auth/invites.test.ts`
Expected: PASS (all `pruneInvites` cases plus every pre-existing test in the file)

- [ ] **Step 5: Typecheck and commit**

Run: `pnpm --filter server typecheck`
Expected: no errors

```bash
git add packages/server/src/auth/invites.ts packages/server/src/auth/invites.test.ts
git commit -m "feat(server): add pruneInvites for bulk-deleting dead invite records"
```

---

### Task 2: `prune-invites` CLI script

**Files:**
- Create: `packages/server/scripts/prune-invites.ts`
- Create: `packages/server/scripts/prune-invites.cli.ts`
- Create: `packages/server/scripts/prune-invites.test.ts`
- Modify: `packages/server/rspack.config.ts:10-16` (add one entry)

**Interfaces:**
- Consumes: `pruneInvites`, `InvitePruneResult` from `../src/auth/invites` (Task 1); `createValkeyOps`, `ValkeyOps` from `../src/storage/valkey`.
- Produces: `export async function runPruneInvites(ops: ValkeyOps, now: () => number, opts?: { dryRun?: boolean }): Promise<InvitePruneResult>` and `export async function runPruneInvitesCli(): Promise<void>` — not consumed by later tasks, but must follow the same naming convention as `runRevokeAccount`/`runRevokeAccountCli` etc.

- [ ] **Step 1: Write the failing test**

Create `packages/server/scripts/prune-invites.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { consumeInvite, createInvite } from '../src/auth/invites'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runPruneInvites } from './prune-invites'

const now = () => 1_700_000_000_000

describe('runPruneInvites', () => {
  it('prunes consumed invites and keeps active ones', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    await createInvite(ops, now, { ttlMs: 60_000, label: 'active' })
    const { token, record } = await createInvite(ops, now, { ttlMs: 60_000, maxUses: 1 })
    await consumeInvite(ops, now, token)

    const result = await runPruneInvites(ops, now)

    expect(result).toEqual({ pruned: [{ id: record.id, status: 'consumed' }], kept: 1 })
  })

  it('dry-run leaves every invite in place', async () => {
    const ops = createMemoryOps(createMemoryPubSub())
    const { token, record } = await createInvite(ops, now, { ttlMs: 60_000, maxUses: 1 })
    await consumeInvite(ops, now, token)

    const result = await runPruneInvites(ops, now, { dryRun: true })

    expect(result).toEqual({ pruned: [{ id: record.id, status: 'consumed' }], kept: 0 })
    const remaining = await ops.scanKeys('invite:')
    expect(remaining).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run scripts/prune-invites.test.ts`
Expected: FAIL — cannot find module `./prune-invites`

- [ ] **Step 3: Write `prune-invites.ts` and `prune-invites.cli.ts`**

Create `packages/server/scripts/prune-invites.ts`:

```ts
import { type InvitePruneResult, pruneInvites } from '../src/auth/invites'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export function runPruneInvites(
  ops: ValkeyOps,
  now: () => number,
  opts?: { dryRun?: boolean },
): Promise<InvitePruneResult> {
  return pruneInvites(ops, now, opts)
}

export async function runPruneInvitesCli(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')

  const ops = createValkeyOps()
  const result = await runPruneInvites(ops, Date.now, { dryRun })

  for (const { id, status } of result.pruned) {
    console.log(`${id}  [${status}]`)
  }

  const verb = dryRun ? 'Would prune' : 'Pruned'
  console.log(`${verb} ${result.pruned.length} invite(s), kept ${result.kept}.`)
  process.exit(0)
}
```

Create `packages/server/scripts/prune-invites.cli.ts`:

```ts
import { runPruneInvitesCli } from './prune-invites'

void runPruneInvitesCli()
```

- [ ] **Step 4: Register the rspack entry**

In `packages/server/rspack.config.ts`, change:

```ts
    'scripts/mint-add-device-token': './scripts/mint-add-device-token.cli.ts',
  },
```

to:

```ts
    'scripts/mint-add-device-token': './scripts/mint-add-device-token.cli.ts',
    'scripts/prune-invites': './scripts/prune-invites.cli.ts',
  },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server exec vitest run scripts/prune-invites.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck, build, and commit**

Run: `pnpm --filter server typecheck && pnpm --filter server build`
Expected: no errors; `dist/scripts/prune-invites.cjs` is emitted

```bash
git add packages/server/scripts/prune-invites.ts packages/server/scripts/prune-invites.cli.ts packages/server/scripts/prune-invites.test.ts packages/server/rspack.config.ts
git commit -m "feat(server): add prune-invites CLI command"
```

---

### Task 3: `revoke-devices` CLI script

**Files:**
- Create: `packages/server/scripts/revoke-devices.ts`
- Create: `packages/server/scripts/revoke-devices.cli.ts`
- Create: `packages/server/scripts/revoke-devices.test.ts`
- Modify: `packages/server/rspack.config.ts` (add one entry)

**Interfaces:**
- Consumes: `getAccount`, `listAccountDeviceIds` from `../src/auth/accounts`; `revokeDevice` from `../src/auth/devices`; `AccountNotFoundError` from `../src/auth/errors`; `createValkeyOps`, `ValkeyOps` from `../src/storage/valkey`.
- Produces: `export async function runRevokeDevices(ops: ValkeyOps, accountId: string, opts?: { dryRun?: boolean }): Promise<{ revoked: number } | AccountNotFoundError | Error>` and `export async function runRevokeDevicesCli(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `packages/server/scripts/revoke-devices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import {
  addDeviceToAccount,
  createAccount,
  getAccount,
  listAccountDeviceIds,
} from '../src/auth/accounts'
import { getDevice, storeDevice } from '../src/auth/devices'
import { AccountNotFoundError, DeviceNotFoundError } from '../src/auth/errors'
import { createMemoryOps, createMemoryPubSub } from '../src/test/memory-ops'
import { runRevokeDevices } from './revoke-devices'

const now = () => 1_700_000_000_000

function makeOps() {
  return createMemoryOps(createMemoryPubSub())
}

describe('runRevokeDevices', () => {
  it('revokes every device on the account but keeps the account itself', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, now, { name: 'Dana', inviteId: 'inv' })
    for (const credentialId of ['c1', 'c2']) {
      await storeDevice(ops, {
        credentialId,
        publicKey: 'pk',
        signCount: 0,
        label: credentialId,
        createdAt: now(),
        lastSeenAt: now(),
        disabled: false,
        accountId: account.id,
        status: 'active',
        addedVia: 'invite',
      })
      await addDeviceToAccount(ops, account.id, credentialId, { countsAgainstLimit: false })
    }

    const result = await runRevokeDevices(ops, account.id)

    expect(result).toEqual({ revoked: 2 })
    expect(await getAccount(ops, account.id)).not.toBeInstanceOf(Error)
    expect(await getDevice(ops, 'c1')).toBeInstanceOf(DeviceNotFoundError)
    expect(await getDevice(ops, 'c2')).toBeInstanceOf(DeviceNotFoundError)
    expect(await listAccountDeviceIds(ops, account.id)).toEqual([])
  })

  it('returns AccountNotFoundError for an unknown account', async () => {
    const ops = makeOps()
    expect(await runRevokeDevices(ops, 'missing')).toBeInstanceOf(AccountNotFoundError)
  })

  it('dry-run reports the device count without revoking anything', async () => {
    const ops = makeOps()
    const account = await createAccount(ops, now, { name: 'Erin', inviteId: 'inv' })
    await storeDevice(ops, {
      credentialId: 'c1',
      publicKey: 'pk',
      signCount: 0,
      label: 'c1',
      createdAt: now(),
      lastSeenAt: now(),
      disabled: false,
      accountId: account.id,
      status: 'active',
      addedVia: 'invite',
    })
    await addDeviceToAccount(ops, account.id, 'c1', { countsAgainstLimit: false })

    const result = await runRevokeDevices(ops, account.id, { dryRun: true })

    expect(result).toEqual({ revoked: 1 })
    expect(await getDevice(ops, 'c1')).not.toBeInstanceOf(Error)
    expect(await listAccountDeviceIds(ops, account.id)).toEqual(['c1'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter server exec vitest run scripts/revoke-devices.test.ts`
Expected: FAIL — cannot find module `./revoke-devices`

- [ ] **Step 3: Write `revoke-devices.ts` and `revoke-devices.cli.ts`**

Create `packages/server/scripts/revoke-devices.ts`:

```ts
import { getAccount, listAccountDeviceIds } from '../src/auth/accounts'
import { revokeDevice } from '../src/auth/devices'
import type { AccountNotFoundError } from '../src/auth/errors'
import { createValkeyOps, type ValkeyOps } from '../src/storage/valkey'

export async function runRevokeDevices(
  ops: ValkeyOps,
  accountId: string,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ revoked: number } | AccountNotFoundError | Error> {
  const account = await getAccount(ops, accountId)
  if (account instanceof Error) return account

  const ids = await listAccountDeviceIds(ops, accountId)
  if (!dryRun) {
    for (const credentialId of ids) {
      await revokeDevice(ops, credentialId) // cascades that device's sessions
    }
  }
  return { revoked: ids.length }
}

export async function runRevokeDevicesCli(): Promise<void> {
  const flagIndex = process.argv.indexOf('--account')
  const accountId = flagIndex === -1 ? undefined : process.argv[flagIndex + 1]
  if (!accountId) {
    console.error('Usage: revoke-devices --account <accountId> [--dry-run]')
    process.exit(1)
  }
  const dryRun = process.argv.includes('--dry-run')

  const ops = createValkeyOps()
  const result = await runRevokeDevices(ops, accountId, { dryRun })
  if (result instanceof Error) {
    console.error(result.message)
    process.exit(1)
  }

  if (dryRun) {
    console.log(`Would revoke ${result.revoked} device(s) for account ${accountId}; account kept.`)
  } else {
    console.log(`Account ${accountId} kept; ${result.revoked} device(s) revoked.`)
  }
  process.exit(0)
}
```

Create `packages/server/scripts/revoke-devices.cli.ts`:

```ts
import { runRevokeDevicesCli } from './revoke-devices'

void runRevokeDevicesCli()
```

- [ ] **Step 4: Register the rspack entry**

In `packages/server/rspack.config.ts`, change:

```ts
    'scripts/prune-invites': './scripts/prune-invites.cli.ts',
  },
```

to:

```ts
    'scripts/prune-invites': './scripts/prune-invites.cli.ts',
    'scripts/revoke-devices': './scripts/revoke-devices.cli.ts',
  },
```

(This step assumes Task 2 has already landed the `prune-invites` entry above it; if executing this task out of order, add `'scripts/revoke-devices': './scripts/revoke-devices.cli.ts',` as its own new line inside the existing `entry` map instead.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter server exec vitest run scripts/revoke-devices.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck, build, and commit**

Run: `pnpm --filter server typecheck && pnpm --filter server build`
Expected: no errors; `dist/scripts/revoke-devices.cjs` is emitted

```bash
git add packages/server/scripts/revoke-devices.ts packages/server/scripts/revoke-devices.cli.ts packages/server/scripts/revoke-devices.test.ts packages/server/rspack.config.ts
git commit -m "feat(server): add revoke-devices CLI command to bulk-revoke an account's devices"
```

---

### Task 4: ASCII QR code in `create-invite`

**Files:**
- Modify: `packages/server/package.json` (add `qrcode-terminal` dependency and `@types/qrcode-terminal` devDependency)
- Modify: `packages/server/scripts/create-invite.ts:1-5,92-96` (import + one line in `runCli`)

**Interfaces:**
- Consumes: `qrcode-terminal`'s `generate(text: string, opts: { small?: boolean }, callback: (qr: string) => void)`.
- Produces: no new exports; `runCli`'s behavior changes (stdout unchanged, stderr gains QR art).

- [ ] **Step 1: Install the dependency**

Run:
```bash
pnpm --filter server add qrcode-terminal
pnpm --filter server add -D @types/qrcode-terminal
```
Expected: `packages/server/package.json` gains a `qrcode-terminal` entry under `"dependencies"` and `@types/qrcode-terminal` under `"devDependencies"`; `pnpm-lock.yaml` updates accordingly.

- [ ] **Step 2: Add the import**

In `packages/server/scripts/create-invite.ts`, change:

```ts
import * as errore from 'errore'

import { loadAuthConfig, parseDuration } from '../src/auth/config'
```

to:

```ts
import * as errore from 'errore'
import * as qrcodeTerminal from 'qrcode-terminal'

import { loadAuthConfig, parseDuration } from '../src/auth/config'
```

- [ ] **Step 3: Print the QR code to stderr after the URL**

In `packages/server/scripts/create-invite.ts`, change the end of `runCli`:

```ts
  const ops = createValkeyOps()
  const url = await runCreateInvite(ops, Date.now, publicAppUrl, args)
  console.log(url)
  process.exit(0)
}
```

to:

```ts
  const ops = createValkeyOps()
  const url = await runCreateInvite(ops, Date.now, publicAppUrl, args)
  console.log(url)
  qrcodeTerminal.generate(url, { small: true }, (qr) => console.error(qr))
  process.exit(0)
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter server typecheck`
Expected: no errors. If `@types/qrcode-terminal` doesn't ship a default-callback-style signature matching this call, adjust the call to match whatever signature the installed `@types/qrcode-terminal` version declares (check `node_modules/@types/qrcode-terminal/index.d.ts`) — the goal is simply "print an ASCII QR of `url` to stderr using this library," not this exact call shape.

- [ ] **Step 5: Manually verify stdout/stderr separation**

This behavior isn't unit-testable (it's CLI-glue in `runCli`, which the existing test suite for `create-invite` deliberately doesn't exercise — see `create-invite.test.ts`'s coverage of `parseArgs`/`runCreateInvite` only). Verify manually:

```bash
pnpm --filter server build
VALKEY_URL=redis://localhost:6379 PUBLIC_APP_URL=http://localhost:5173 RP_ID=localhost RP_NAME=MyBoard EXPECTED_ORIGIN=http://localhost:5173 node packages/server/dist/scripts/create-invite.cjs --label manual-qr-check > /tmp/stdout.txt 2> /tmp/stderr.txt
cat /tmp/stdout.txt
cat /tmp/stderr.txt
```
Expected: `/tmp/stdout.txt` contains exactly one line matching `http://localhost:5173/activate?token=...` and nothing else; `/tmp/stderr.txt` contains ASCII QR block art. Requires a reachable Valkey at `VALKEY_URL` (e.g. `pnpm start:docker` from the repo root, or any local Valkey/Redis instance).

- [ ] **Step 6: Commit**

```bash
git add packages/server/package.json pnpm-lock.yaml packages/server/scripts/create-invite.ts
git commit -m "feat(server): print an ASCII QR code alongside the create-invite URL"
```

---

## Self-Review Notes

- **Spec coverage:** `prune-invites` (Tasks 1–2), `revoke-devices --account <id>` (Task 3), QR code in `create-invite` (Task 4) — all three spec items have a task. `--dry-run` is implemented for both new commands per the spec's later clarification. stdout/stderr separation for the QR code is implemented and manually verified per the spec.
- **Type consistency:** `InvitePruneResult` (Task 1) is the return type of both `pruneInvites` (Task 1) and `runPruneInvites` (Task 2) — verified matching. `AccountNotFoundError` is returned by `runRevokeDevices` (Task 3), matching the existing `getAccount` return type already used by `revoke-account.ts`.
- **Out of scope confirmed:** no changes made to `revoke-account.ts`, `revoke-invite.ts`, `revoke-device.ts`, `list-invites.ts`, `list-devices.ts`, and no admin HTTP API or cron scheduling introduced, per the design doc.
