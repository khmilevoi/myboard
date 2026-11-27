import { randomUUID } from 'node:crypto'

import type { ConsentCode, ScaleUserIndex } from '@shared/hardware/spike-assumptions'

import { getJson, setJson } from '../auth/records'
import { runExclusive } from '../storage/key-lock'
import { generateConsentCode } from './consent-code'
import {
  BindingNotFoundError,
  GatewayOfflineError,
  HardwareNotFoundError,
  HealthProfileMissingError,
  NotBindingOwnerError,
  ScaleProfileBoundError,
  ScaleProfileUnknownError,
} from './errors'
import { readHealthProfile } from './health-access'
import { type HardwareDeps, logHardwareFailure } from './http'
import { commandKey } from './keys'
import { syncBindings } from './profile-sync'
import {
  type BindingRecord,
  type HardwareRecord,
  type PendingCommandRecord,
  PendingCommandRecordSchema,
} from './records'
import { scaleProfileFromHealth } from './scale-profile'
import { getBindings, getHardware, updateBindings, updateHardware } from './store'

/** How long a create/attach waits for the gateway's answer before it is forgotten. */
export const COMMAND_TTL_MS = 10 * 60_000

/** The hardware, or the error to answer; requires it attached to an online gateway. */
async function onlineHardware(
  deps: HardwareDeps,
  hardwareId: string,
): Promise<(HardwareRecord & { gatewayId: string }) | Error> {
  const hardware = await getHardware(deps.ops, hardwareId)
  if (hardware instanceof Error) return hardware
  if (hardware === null) return new HardwareNotFoundError()
  const gatewayId = hardware.gatewayId
  if (gatewayId === null || !deps.connections.isOnline(gatewayId)) return new GatewayOfflineError()
  return { ...hardware, gatewayId }
}

/** The caller's own binding at `index`, or the error to answer. Works offline. */
async function ownBinding(
  deps: HardwareDeps,
  viewerAccountId: string,
  hardwareId: string,
  index: number,
): Promise<{ hardware: HardwareRecord; binding: BindingRecord } | Error> {
  const hardware = await getHardware(deps.ops, hardwareId)
  if (hardware instanceof Error) return hardware
  if (hardware === null) return new HardwareNotFoundError()
  const bindings = await getBindings(deps.ops, hardwareId)
  if (bindings instanceof Error) return bindings
  const binding = bindings.find((candidate) => candidate.index === index)
  if (binding === undefined) return new BindingNotFoundError()
  if (binding.accountId !== viewerAccountId) return new NotBindingOwnerError()
  return { hardware, binding }
}

async function putPendingCommand(deps: HardwareDeps, record: PendingCommandRecord) {
  await runExclusive(commandKey(record.id), () =>
    setJson(deps.ops, commandKey(record.id), record, COMMAND_TTL_MS),
  )
}

async function dropPendingCommand(deps: HardwareDeps, id: string) {
  await runExclusive(commandKey(id), () => deps.ops.del(commandKey(id)))
}

export async function createScaleProfile(
  deps: HardwareDeps,
  viewerAccountId: string,
  hardwareId: string,
): Promise<{ commandId: string } | Error> {
  const hardware = await onlineHardware(deps, hardwareId)
  if (hardware instanceof Error) return hardware
  const profile = await readHealthProfile(deps.ops, deps.now, viewerAccountId)
  if (profile instanceof Error) return profile
  if (profile === null) return new HealthProfileMissingError()

  const commandId = randomUUID()
  const consentCode = generateConsentCode()
  await putPendingCommand(deps, {
    id: commandId,
    type: 'scaleUser.create',
    gatewayId: hardware.gatewayId,
    hardwareId,
    accountId: viewerAccountId,
    consentCode,
    index: null,
  })
  const sent = deps.connections.send(hardware.gatewayId, {
    id: commandId,
    type: 'scaleUser.create',
    hardwareId,
    address: hardware.address,
    consentCode,
    profile: scaleProfileFromHealth(profile),
  })
  if (!sent) {
    await dropPendingCommand(deps, commandId)
    return new GatewayOfflineError()
  }
  // The code is not answered here: the owner fetches it through the reveal endpoint.
  return { commandId }
}

export async function attachScaleProfile(
  deps: HardwareDeps,
  viewerAccountId: string,
  hardwareId: string,
  index: ScaleUserIndex,
  consentCode: ConsentCode,
): Promise<{ commandId: string } | Error> {
  const hardware = await onlineHardware(deps, hardwareId)
  if (hardware instanceof Error) return hardware
  if (!hardware.scaleUsers.some((user) => user.index === index)) {
    return new ScaleProfileUnknownError()
  }
  const bindings = await getBindings(deps.ops, hardwareId)
  if (bindings instanceof Error) return bindings
  if (bindings.some((binding) => binding.index === index)) return new ScaleProfileBoundError()

  const commandId = randomUUID()
  await putPendingCommand(deps, {
    id: commandId,
    type: 'scaleUser.attach',
    gatewayId: hardware.gatewayId,
    hardwareId,
    accountId: viewerAccountId,
    consentCode,
    index,
  })
  // The binding is written only once the scale accepts the code (`scaleUser.attached`).
  const sent = deps.connections.send(hardware.gatewayId, {
    id: commandId,
    type: 'scaleUser.attach',
    hardwareId,
    address: hardware.address,
    index,
    consentCode,
  })
  if (!sent) {
    await dropPendingCommand(deps, commandId)
    return new GatewayOfflineError()
  }
  return { commandId }
}

export async function unbindScaleProfile(
  deps: HardwareDeps,
  viewerAccountId: string,
  hardwareId: string,
  index: number,
): Promise<void | Error> {
  const hardware = await getHardware(deps.ops, hardwareId)
  if (hardware instanceof Error) return hardware
  if (hardware === null) return new HardwareNotFoundError()
  // Checked again under the lock: the binding may have changed since any earlier read.
  const removed = await updateBindings(deps.ops, hardwareId, (current) => {
    const binding = current.find((candidate) => candidate.index === index)
    if (binding === undefined) return new BindingNotFoundError()
    if (binding.accountId !== viewerAccountId) return new NotBindingOwnerError()
    return current.filter((candidate) => candidate !== binding)
  })
  if (removed instanceof Error) return removed

  const published = await deps.publish({ type: 'changed' })
  if (published instanceof Error) logHardwareFailure('unbind publish', published)
  if (hardware.gatewayId !== null) {
    const synced = await syncBindings(deps, hardware.gatewayId)
    if (synced instanceof Error) logHardwareFailure('unbind sync', synced)
  }
}

/** The only path that returns a consent code to a browser; the route sends `no-store`. */
export async function revealConsentCode(
  deps: HardwareDeps,
  viewerAccountId: string,
  hardwareId: string,
  index: number,
): Promise<{ consentCode: ConsentCode } | Error> {
  const own = await ownBinding(deps, viewerAccountId, hardwareId, index)
  if (own instanceof Error) return own
  return { consentCode: own.binding.consentCode }
}

// ---- Gateway answers ----

/**
 * Runs `apply` on the pending command `commandId` under its lock, if it exists, belongs to
 * `gatewayId` and (when `expected` is set) is of that type; anything else (expired, unknown,
 * another gateway's, a mismatched answer) is ignored and kept. The record is deleted only after
 * `apply` succeeded, so a failure makes the resent batch redo every step.
 */
function withPendingCommand(
  deps: HardwareDeps,
  gatewayId: string,
  commandId: string,
  expected: PendingCommandRecord['type'] | null,
  apply: (pending: PendingCommandRecord) => Promise<void | Error>,
): Promise<void | Error> {
  return runExclusive(commandKey(commandId), async () => {
    const pending = await getJson(deps.ops, commandKey(commandId), PendingCommandRecordSchema)
    if (pending instanceof Error) return pending
    if (pending === null || pending.gatewayId !== gatewayId) return
    if (expected !== null && pending.type !== expected) return
    const applied = await apply(pending)
    if (applied instanceof Error) return applied
    await deps.ops.del(commandKey(commandId))
  })
}

async function failCommand(deps: HardwareDeps, commandId: string, reason: string) {
  return deps.publish({ type: 'command', commandId, ok: false, reason })
}

/**
 * Gateway events `scaleUser.created` (`createdIndex` set) and `scaleUser.attached`: the scale
 * accepted the user, so the binding is written. Idempotent on a resent batch.
 */
export function completeScaleUserCommand(
  deps: HardwareDeps,
  gatewayId: string,
  commandId: string,
  expected: PendingCommandRecord['type'],
  createdIndex: ScaleUserIndex | null,
): Promise<void | Error> {
  return withPendingCommand(deps, gatewayId, commandId, expected, async (pending) => {
    const index = createdIndex ?? pending.index
    if (index === null) return

    const hardware = await getHardware(deps.ops, pending.hardwareId)
    if (hardware instanceof Error) return hardware
    // Unpaired or moved meanwhile: there is nothing left to bind to.
    if (hardware === null || hardware.gatewayId !== gatewayId) {
      return failCommand(deps, commandId, 'hardware_not_found')
    }

    const written = await updateBindings(deps.ops, pending.hardwareId, (current) => {
      const existing = current.find((binding) => binding.index === index)
      if (existing !== undefined) {
        // This very command, applied by an earlier delivery of the batch.
        const same =
          existing.accountId === pending.accountId && existing.consentCode === pending.consentCode
        return same ? current : new ScaleProfileBoundError()
      }
      return [
        ...current,
        {
          hardwareId: pending.hardwareId,
          index,
          accountId: pending.accountId,
          consentCode: pending.consentCode,
          createdAt: deps.now(),
          profileRevision: 0,
          appliedRevision: 0,
        },
      ]
    })
    if (written instanceof ScaleProfileBoundError) {
      return failCommand(deps, commandId, written.code)
    }
    if (written instanceof Error) return written

    const listed = await updateHardware(deps.ops, pending.hardwareId, (current) =>
      current.scaleUsers.some((user) => user.index === index)
        ? current
        : {
            ...current,
            scaleUsers: [...current.scaleUsers, { index }].sort((a, b) => a.index - b.index),
          },
    )
    if (listed instanceof Error) return listed

    const done = await deps.publish({ type: 'command', commandId, ok: true, reason: null })
    if (done instanceof Error) return done
    const changed = await deps.publish({ type: 'changed' })
    if (changed instanceof Error) return changed
    return syncBindings(deps, gatewayId)
  })
}

/** Gateway event `command.failed`: the board learns why; nothing is bound. */
export function failScaleUserCommand(
  deps: HardwareDeps,
  gatewayId: string,
  commandId: string,
  reason: string,
): Promise<void | Error> {
  return withPendingCommand(deps, gatewayId, commandId, null, () =>
    failCommand(deps, commandId, reason),
  )
}

/** Gateway event `scaleUser.updated`: the scale holds profile `revision` for that user. */
export async function applyScaleUserUpdated(
  deps: HardwareDeps,
  gatewayId: string,
  event: { hardwareId: string; index: number; revision: number },
): Promise<void | Error> {
  const hardware = await getHardware(deps.ops, event.hardwareId)
  if (hardware instanceof Error) return hardware
  // Only the owning gateway may acknowledge for a scale.
  if (hardware === null || hardware.gatewayId !== gatewayId) return
  return updateBindings(deps.ops, event.hardwareId, (current) =>
    current.map((binding) =>
      binding.index === event.index
        ? {
            ...binding,
            // Never past the revision actually sent: a stale ack (an earlier binding of this
            // index, whose revisions restarted at 0) would otherwise silence every later update.
            appliedRevision: Math.min(
              binding.profileRevision,
              Math.max(binding.appliedRevision, event.revision),
            ),
          }
        : binding,
    ),
  )
}
