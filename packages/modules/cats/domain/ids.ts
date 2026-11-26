import { z } from 'zod'

/**
 * The id of a cat or a litter. It is a storage-key segment (`litter/<id>/…`, `cat/<id>/…`), so the
 * shape is the guard: lowercase, no `/` or `:`, at most 64 characters. Display names never enter
 * keys, so renaming a cat never orphans its data.
 */
export const EntityIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/)

/** The fixed id of the migrated cat and of her litter. */
export const OFELIA_ID = 'ofelia' as const
