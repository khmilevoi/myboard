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

/**
 * Unlike every other key here, these two are relative to a widget's instance scope
 * (`w:i:<instanceId>:`, `instanceNamespace` in `@shared/storage/scope`), not to `m:cats:s:`: they
 * hold one card's own choice of a cat or a litter, so the full keys are
 * `w:i:<instanceId>:card/cat` and `w:i:<instanceId>:card/litter`. Renaming either forgets every
 * card's choice.
 */
export const CARD_CAT_KEY = 'card/cat'

export const CARD_LITTER_KEY = 'card/litter'

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

/**
 * The cat's avatar is a file slot, not a storage value: the slot key below is stored at
 * `m:cats:s:@files/cat/<catId>/avatar` and its `FileRef` is the only source of truth (the profile's
 * `avatar` stays null). Renaming it orphans every uploaded avatar.
 */
export function catAvatarSlotKey(catId: string): string {
  return catKey(catId, 'avatar')
}

/** Matches `catAvatarSlotKey` for an `EntityIdSchema` id; the server's file policy keys on it. */
export const CAT_AVATAR_SLOT_PATTERN = /^cat\/[a-z0-9][a-z0-9-]{0,63}\/avatar$/
