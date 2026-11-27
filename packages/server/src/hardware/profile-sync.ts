import { randomUUID } from 'node:crypto'

import { PROFILE_KEY } from '@modules/health/domain/keys'
import { ProfileSchema } from '@modules/health/domain/profile'
import type { GatewayCommand } from '@shared/hardware/gateway-protocol'
import { moduleAccountNamespace, toFullKey } from '@shared/storage/scope'

import type { StorageEvent } from '../storage/schemas'
import { readHealthProfile } from './health-access'
import { type HardwareDeps, logHardwareFailure } from './http'
import { scaleProfileFromHealth } from './scale-profile'
import { getBindings, listHardware, updateBindings } from './store'

type SyncCommand = Extract<GatewayCommand, { type: 'bindings.sync' }>
type SyncedHardware = SyncCommand['hardware'][number]
type SyncedBinding = SyncCommand['bindings'][number]

/**
 * Tells a gateway every hardware attached to it, bound or not, and every binding of each
 * (`bindings.sync`), so it knows the `hardwareId` of each scale and can recognise its readings.
 * A no-op while the gateway is offline: it syncs on reconnect.
 */
export async function syncBindings(deps: HardwareDeps, gatewayId: string): Promise<void | Error> {
  if (!deps.connections.isOnline(gatewayId)) return
  const all = await listHardware(deps.ops)
  if (all instanceof Error) return all
  const attached: SyncedHardware[] = []
  const bindings: SyncedBinding[] = []
  for (const hardware of all) {
    if (hardware.gatewayId !== gatewayId) continue
    attached.push({ hardwareId: hardware.id, address: hardware.address, model: hardware.model })
    const own = await getBindings(deps.ops, hardware.id)
    if (own instanceof Error) return own
    for (const binding of own) {
      bindings.push({
        hardwareId: hardware.id,
        address: hardware.address,
        model: hardware.model,
        index: binding.index,
        consentCode: binding.consentCode,
      })
    }
  }
  deps.connections.send(gatewayId, {
    id: randomUUID(),
    type: 'bindings.sync',
    hardware: attached,
    bindings,
  })
}

/**
 * Sends `scaleUser.update` for every binding on this gateway's hardware whose profile revision the
 * scale has not acknowledged yet. Re-sent on every call until `scaleUser.updated` catches up, so
 * an update made while the gateway was offline arrives on its next stream open. One owner's
 * unreadable profile is logged and skipped; the others are still sent.
 */
export async function sendPendingUpdates(
  deps: HardwareDeps,
  gatewayId: string,
): Promise<void | Error> {
  if (!deps.connections.isOnline(gatewayId)) return
  const all = await listHardware(deps.ops)
  if (all instanceof Error) return all
  for (const hardware of all) {
    if (hardware.gatewayId !== gatewayId) continue
    const bindings = await getBindings(deps.ops, hardware.id)
    if (bindings instanceof Error) return bindings
    for (const binding of bindings) {
      if (binding.profileRevision <= binding.appliedRevision) continue
      const profile = await readHealthProfile(deps.ops, deps.now, binding.accountId)
      if (profile instanceof Error) {
        logHardwareFailure('profile read', profile)
        continue
      }
      // Deleted since the change: nothing to tell the scale.
      if (profile === null) continue
      deps.connections.send(gatewayId, {
        id: randomUUID(),
        type: 'scaleUser.update',
        hardwareId: hardware.id,
        address: hardware.address,
        index: binding.index,
        consentCode: binding.consentCode,
        profile: scaleProfileFromHealth(profile),
        revision: binding.profileRevision,
      })
    }
  }
}

const HEALTH_PROFILE_KEY = /^m:health:a:([^:]+):profile$/

/**
 * The account whose health profile `fullKey` is (`m:health:a:<accountId>:profile`), else `null`.
 * The match is confirmed against the health module's own key builders, so it cannot drift.
 */
export function healthProfileAccountId(fullKey: string): string | null {
  const accountId = HEALTH_PROFILE_KEY.exec(fullKey)?.[1]
  if (accountId === undefined) return null
  const expected = toFullKey(moduleAccountNamespace('health', accountId), PROFILE_KEY)
  return expected === fullKey ? accountId : null
}

/**
 * A storage event, after fanout. A saved health profile bumps `profileRevision` on every binding
 * of that account, then pushes the update to each affected online gateway. Runs detached from the
 * write, so it never rejects: failures are logged by name only, never with a value.
 */
export async function onStorageEvent(deps: HardwareDeps, event: StorageEvent): Promise<void> {
  const handled = await applyProfileChange(deps, event).catch((cause: unknown) =>
    cause instanceof Error ? cause : new Error('profile sync failed', { cause }),
  )
  if (handled instanceof Error) logHardwareFailure('profile sync', handled)
}

async function applyProfileChange(deps: HardwareDeps, event: StorageEvent): Promise<void | Error> {
  const accountId = healthProfileAccountId(event.key)
  if (accountId === null) return
  // A deleted or invalid profile cannot be sent to a scale.
  if (event.value === null || !ProfileSchema.safeParse(event.value).success) return

  const all = await listHardware(deps.ops)
  if (all instanceof Error) return all
  const gateways = new Set<string>()
  for (const hardware of all) {
    // A cheap unlocked look first; the locked update below decides.
    const seen = await getBindings(deps.ops, hardware.id)
    if (seen instanceof Error) return seen
    if (!seen.some((binding) => binding.accountId === accountId)) continue
    let bumped = false
    const updated = await updateBindings(deps.ops, hardware.id, (current) =>
      current.map((binding) => {
        if (binding.accountId !== accountId) return binding
        bumped = true
        return { ...binding, profileRevision: binding.profileRevision + 1 }
      }),
    )
    if (updated instanceof Error) return updated
    if (bumped && hardware.gatewayId !== null) gateways.add(hardware.gatewayId)
  }
  for (const gatewayId of gateways) {
    const sent = await sendPendingUpdates(deps, gatewayId)
    if (sent instanceof Error) logHardwareFailure('profile update', sent)
  }
}
