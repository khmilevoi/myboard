/**
 * Hardware registry keys are a persistence contract — never change how a key is derived without
 * shipping a data migration in the same release. Every key starts with `hw:`, is server-owned, and
 * is never reachable through the generic `/api/storage` routes (`hw:` is not an allowed namespace).
 * Renaming a prefix silently orphans every registered gateway, paired scale and consent code, and
 * consent codes exist nowhere else. Server code builds these keys only through this file.
 */
export const GATEWAY_CODE_KEY = 'hw:gateway-code'
export const GATEWAY_IDS_KEY = 'hw:gateway-ids'
export const HARDWARE_IDS_KEY = 'hw:hardware-ids'

export function gatewayKey(id: string): string {
  return `hw:gateway:${id}`
}

export function gatewayTokenKey(tokenHash: string): string {
  return `hw:gateway-token:${tokenHash}`
}

export function hardwareKey(id: string): string {
  return `hw:hardware:${id}`
}

export function bindingsKey(hardwareId: string): string {
  return `hw:bindings:${hardwareId}`
}

export function scanKey(gatewayId: string): string {
  return `hw:scan:${gatewayId}`
}

export function pairingKey(id: string): string {
  return `hw:pairing:${id}`
}

export function commandKey(id: string): string {
  return `hw:command:${id}`
}

/** A lock name only (serializes adopt/bond per scale address); nothing is ever stored under it. */
export function addressLockKey(address: string): string {
  return `hw:address-lock:${address}`
}

/**
 * A lock name only (serializes hardware ingest per account, so the duplicate check and the append
 * are one step); nothing is ever stored under it. Never the key `append` itself locks.
 */
export function healthIngestLockKey(accountId: string): string {
  return `hw:health-ingest-lock:${accountId}`
}
