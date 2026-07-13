# Invite/device admin CLI commands — design

## Goal

Extend the existing `packages/server/scripts/` admin CLI set with:

1. `prune-invites` — bulk-delete dead invites.
2. `revoke-devices --account <id>` — bulk-revoke a single account's devices without deleting the account.
3. An ASCII QR code alongside the invite URL printed by `create-invite`.

## Context / existing commands

`packages/server/scripts/` already has, following a fixed 3-file pattern (`<name>.ts` logic + `<name>.cli.ts` entry + `<name>.test.ts`), wired as separate rspack entries in `packages/server/rspack.config.ts`:

- `create-invite` — creates an invite, prints the activation URL to stdout.
- `list-invites` / `list-devices` — read-only listings.
- `revoke-invite --id <id>` — deletes one invite record.
- `revoke-device --credential-id <id>` — revokes one device (cascades session revocation).
- `revoke-account --account <id>` — revokes **all** of an account's devices AND deletes the account record itself (`revoke-account.ts:7-21`).
- `mint-add-device-token` — mints a token for adding a device to an existing account.

Data model (`packages/server/src/auth/records.ts`): `InviteRecord` (keyed `invite:<sha256(token)>`, has native Valkey TTL = `expiresAt - createdAt`), `AccountRecord` (`account:<id>`), `DeviceRecord` (`device:<credentialId>`), plus `account:<id>:devices` (JSON array of credential ids).

`inviteStatus()` (`src/auth/invites.ts:46-51`) computes one of `active | expired | consumed | locked` from record fields at read time. Because invite records already carry a Valkey TTL equal to their `expiresAt`, naturally-expired invites disappear from the store on their own — but invites that become `consumed` (all uses spent) or `locked` (too many failed attempts) before their TTL fires stay in the store and clutter `list-invites` until the original TTL elapses, sometimes days later. `prune-invites` exists to delete those early.

## New command: `prune-invites`

- New function `pruneInvites(ops, now)` in `src/auth/invites.ts`: calls `listAllInvites`, computes `inviteStatus` for each, and for any record with status `expired`, `consumed`, or `locked`, deletes its key. Returns `{ pruned: Array<{ id: string; status: InviteStatus }>, kept: number }`.
- CLI flags: none required. `--dry-run` prints what would be pruned without deleting anything.
- Output, one line per pruned invite (`<id>  [<status>]`), followed by a summary line: `Pruned N invite(s), kept M.` (dry-run summary: `Would prune N invite(s), kept M.`)
- `active` invites are never touched.

## New command: `revoke-devices --account <id>`

- New function in `src/auth/devices.ts` (or reuse pattern from `revoke-account.ts`): given an `accountId`, call `getAccount` (propagate `AccountNotFoundError`), then for each id from `listAccountDeviceIds`, call `revokeDevice` (which already handles session cascade and removes the device from the account's device list via `removeDeviceFromAccount`). Unlike `revoke-account`, does **not** delete `accountKey`/`accountDevicesKey` — the account record survives with an empty device list.
- CLI flags: `--account <id>` required, `--dry-run` prints the device count that would be revoked without revoking.
- Output: `Account <id> kept; N device(s) revoked.` (dry-run: `Would revoke N device(s) for account <id>; account kept.`)

## QR code in `create-invite`

- Add `qrcode-terminal` as a new dependency in `packages/server/package.json`.
- In `create-invite.ts`'s `runCli()`, after `console.log(url)` (stdout, unchanged — this must remain the exact, sole stdout output so any script/automation parsing `create-invite`'s stdout for the URL keeps working), render the QR to **stderr** via `qrcode-terminal`'s callback form (`qrcode.generate(url, { small: true }, (qr) => console.error(qr))`), so the ASCII art doesn't land in stdout.
- Order as printed to the terminal: URL first (stdout), QR art after (stderr) — both interleave in a normal terminal but stdout redirection/piping only ever sees the URL.

## Testing

Follow existing test conventions in `packages/server/scripts/*.test.ts` (in-memory/fake `ValkeyOps`):

- `prune-invites.test.ts`: seed invites in each status (active/expired/consumed/locked); assert `pruneInvites` deletes only expired/consumed/locked and returns correct counts; assert `--dry-run` path performs no deletions.
- `revoke-devices.test.ts`: seed an account with multiple devices; assert all are revoked (and their sessions gone) while `getAccount` still resolves afterward; assert `AccountNotFoundError` on an unknown account; assert `--dry-run` revokes nothing.
- QR rendering in `create-invite` is CLI-glue only (not covered by existing unit tests of `runCreateInvite`/`parseArgs`) — verify manually by running the command once against a local Valkey.

## Out of scope

- No changes to `revoke-account`, `revoke-invite`, `revoke-device`, `list-invites`, `list-devices`.
- No admin HTTP API — these remain server-side ops scripts, consistent with the existing set.
- No scheduled/cron invocation of `prune-invites` — it's a manually-run ops command, same as its siblings.
