/**
 * Storage keys are a persistence contract: module storage prefixes `m:cats:s:` onto what is built
 * here, giving `m:cats:s:litter/<litterId>/…`, `m:cats:s:cat/<catId>/…` and the two registries.
 * The `ofelia-to-cats` migration copies Ofelia's data (`m:ofelia:s:duty/…`, where
 * `ofelia-to-module` put it) into `litter/ofelia/…` and `cat/ofelia/…`. Changing any of these
 * silently orphans existing data. Ids are `EntityIdSchema` values (`./ids`); display names never
 * enter a key.
 */
function litterKey(litterId: string, relative: string): string {
  return `litter/${litterId}/${relative}`
}

function catKey(catId: string, relative: string): string {
  return `cat/${catId}/${relative}`
}

export const CATS_REGISTRY_KEY = 'registry/cats'

export const LITTERS_REGISTRY_KEY = 'registry/litters'

export function ledgerKey(litterId: string): string {
  return litterKey(litterId, 'ledger')
}

/** `weekStartIso` MUST be the output of `weekStartISO(date)`. */
export function commentsKey(litterId: string, weekStartIso: string): string {
  return litterKey(litterId, `comments:${weekStartIso}`)
}

export function litterSettingsKey(litterId: string): string {
  return litterKey(litterId, 'settings')
}

export function catProfileKey(catId: string): string {
  return catKey(catId, 'profile')
}

export function catGoalKey(catId: string): string {
  return catKey(catId, 'goal')
}

export function catWeightKey(catId: string): string {
  return catKey(catId, 'weight')
}
