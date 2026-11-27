import { z } from 'zod'

import { EntityIdSchema } from './ids'

/**
 * Both registries are append-only event logs under `CATS_REGISTRY_KEY` and `LITTERS_REGISTRY_KEY`.
 * `append` is the only write the server storage makes atomic, so two concurrent registry changes
 * can never overwrite each other; every rule ("the last active cat stays active", "no duplicate
 * add") is enforced by the fold, never by a handler's read-then-write.
 */
export const CatRegistryEventSchema = z.object({
  id: z.string(),
  ts: z.number(),
  catId: EntityIdSchema,
  op: z.enum(['add', 'archive', 'restore']),
})
export type CatRegistryEvent = z.infer<typeof CatRegistryEventSchema>
export type CatRegistryEventDraft = Omit<CatRegistryEvent, 'id' | 'ts'>

export const LitterRegistryEventSchema = z.object({
  id: z.string(),
  ts: z.number(),
  litterId: EntityIdSchema,
  op: z.literal('add'),
})
export type LitterRegistryEvent = z.infer<typeof LitterRegistryEventSchema>
export type LitterRegistryEventDraft = Omit<LitterRegistryEvent, 'id' | 'ts'>

/**
 * An append-only array parsed per element: what does not validate is dropped instead of failing
 * the array wholesale, as `LedgerEntriesSchema` does, so one hand-written bad element never blanks
 * the whole list.
 */
export function tolerantArraySchema<T>(element: z.ZodType<T>, label: string) {
  return z.array(z.unknown()).transform((rawElements) =>
    rawElements.flatMap((raw) => {
      const parsed = element.safeParse(raw)
      if (!parsed.success) {
        console.warn(`Dropping malformed ${label}`, parsed.error)
        return []
      }
      return [parsed.data]
    }),
  )
}

export const CatRegistryEventsSchema = tolerantArraySchema(
  CatRegistryEventSchema,
  'cat registry event',
)
export const LitterRegistryEventsSchema = tolerantArraySchema(
  LitterRegistryEventSchema,
  'litter registry event',
)

export type CatRegistry = {
  /** Every known cat id in first-`add` order, archived ones included: a cat's tone follows it. */
  order: string[]
  /** Active cats, in first-`add` order. */
  active: string[]
  archived: { catId: string; archivedAt: number }[]
}

/** Stable: events with an equal `ts` keep their storage (append) order. */
function byTs<T extends { ts: number }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.ts - b.ts)
}

/**
 * Folds the cat registry. A duplicate `add`, an `archive` of a cat that is not active and a
 * `restore` of a cat that is not archived are ignored, and so is an `archive` that would leave no
 * active cat: two archive requests landing together on the last two active cats keep the later
 * one's cat active.
 */
export function foldCatRegistry(events: readonly CatRegistryEvent[]): CatRegistry {
  const order: string[] = []
  const archivedAt = new Map<string, number>()

  for (const event of byTs(events)) {
    const known = order.includes(event.catId)
    if (event.op === 'add') {
      if (!known) order.push(event.catId)
      continue
    }
    if (!known) continue

    const isArchived = archivedAt.has(event.catId)
    if (event.op === 'restore') {
      if (isArchived) archivedAt.delete(event.catId)
      continue
    }

    if (isArchived) continue
    const activeCount = order.length - archivedAt.size
    if (activeCount <= 1) continue
    archivedAt.set(event.catId, event.ts)
  }

  return {
    order,
    active: order.filter((catId) => !archivedAt.has(catId)),
    archived: order.flatMap((catId) => {
      const at = archivedAt.get(catId)
      return at === undefined ? [] : [{ catId, archivedAt: at }]
    }),
  }
}

/** Litter ids, unique, in first-`add` order. */
export function foldLitterRegistry(events: readonly LitterRegistryEvent[]): string[] {
  const ids: string[] = []
  for (const event of byTs(events)) if (!ids.includes(event.litterId)) ids.push(event.litterId)
  return ids
}
