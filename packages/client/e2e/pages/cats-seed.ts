import type { APIRequestContext } from '@playwright/test'
import {
  CATS_REGISTRY_KEY,
  LITTERS_REGISTRY_KEY,
  catProfileKey,
  ledgerKey,
  litterSettingsKey,
} from 'module-cats/domain/keys'
import { DEFAULT_LITTER_SETTINGS } from 'module-cats/domain/roster'

export type SeedCat = { id: string; name: string; litterId: string }

const sharedUrl = (key: string) =>
  `/api/storage/scoped/module/cats/shared/${encodeURIComponent(key)}`

/**
 * Registers `cats`, each on its litter, the way the `ofelia-to-cats` migration seeds Ofelia: both
 * registries as `add` event logs in the given order, each litter's settings at their defaults, and
 * each cat's profile. The e2e stack starts empty (no migration), and a litter card shows its empty
 * state until a cat points at a litter, so every litter spec seeds first.
 */
export async function seedCats(request: APIRequestContext, cats: SeedCat[]): Promise<void> {
  const litterIds = [...new Set(cats.map((cat) => cat.litterId))]
  const seeds: [string, unknown][] = [
    [
      CATS_REGISTRY_KEY,
      cats.map((cat, ts) => ({ id: `seed:${cat.id}`, ts, catId: cat.id, op: 'add' })),
    ],
    [
      LITTERS_REGISTRY_KEY,
      litterIds.map((litterId, ts) => ({ id: `seed:${litterId}`, ts, litterId, op: 'add' })),
    ],
    ...litterIds.map((litterId): [string, unknown] => [
      litterSettingsKey(litterId),
      DEFAULT_LITTER_SETTINGS,
    ]),
    ...cats.map((cat): [string, unknown] => [
      catProfileKey(cat.id),
      {
        name: cat.name,
        breed: null,
        birthDate: null,
        sex: null,
        sterilized: 'unknown',
        bodyCondition: null,
        avatar: null,
        litterId: cat.litterId,
      },
    ]),
  ]
  for (const [key, value] of seeds) {
    const response = await request.put(sharedUrl(key), {
      headers: { 'X-Requested-With': 'MyBoard' },
      data: { value },
    })
    if (!response.ok()) throw new Error(`seeding ${key} failed with status ${response.status()}`)
  }
}

/** Puts `entries` into a litter's ledger. */
export async function seedLedger(
  request: APIRequestContext,
  litterId: string,
  entries: unknown[],
): Promise<void> {
  const response = await request.put(sharedUrl(ledgerKey(litterId)), {
    headers: { 'X-Requested-With': 'MyBoard' },
    data: { value: entries },
  })
  if (!response.ok()) throw new Error(`seeding the ledger failed with status ${response.status()}`)
}
