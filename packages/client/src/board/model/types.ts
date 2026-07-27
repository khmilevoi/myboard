import { z } from 'zod'

export const WidgetInstanceSchema = z.object({ id: z.string(), typeId: z.string() })
export type WidgetInstance = z.infer<typeof WidgetInstanceSchema>

export const LayoutItemSchema = z.object({
  i: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  minW: z.number().optional(),
  minH: z.number().optional(),
})
export type LayoutItem = z.infer<typeof LayoutItemSchema>

// Loose, not strict: `boards` is the shared server-backed record
// (board-storage.ts), read and written by every connected client. A client
// still on an older bundle that predates a newly added optional field (like
// mobileLayout below) must not delete that field just because it doesn't
// recognise it — a strict/plain z.object() strips unknown keys on parse, and
// this schema's write path re-serializes exactly what parse produced, so a
// stale reader's first local write would silently wipe the field board-wide.
// Every future additive board field inherits this same hazard, so keep
// unknown keys passing through here rather than special-casing one field.
//
// This is a real, currently-live exposure, not a hypothetical: main's
// BoardSnapshotSchema (pre-mobileLayout) is a plain z.object, so a still-open
// main-era tab that touches a board during this release window strips
// mobileLayout on its first local write-back. Loose parsing here limits the
// blast radius to "that field resets to its absent/derived state", not a
// crash or data corruption — there is no cheap way to make an *additive*
// field survive a client that predates it and doesn't know to preserve it.
// Do not add state here that must never be dropped this way; see
// board-storage.ts's localBoardMigrations/sharedBoardMigrations for the
// pattern to use instead (a separate storage key an old bundle never touches
// at all, so it can't strip what it never reads).
export const BoardSnapshotSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  instances: z.array(WidgetInstanceSchema),
  // Desktop layout, and the source the mobile layout is derived from. Renaming
  // this would be a data migration; do not.
  layout: z.array(LayoutItemSchema),
  // Present only once the user has rearranged the board on a mobile-width
  // viewport. Its absence IS the "not yet overridden" state.
  mobileLayout: z.array(LayoutItemSchema).optional(),
})
export type BoardSnapshot = z.infer<typeof BoardSnapshotSchema>

export const BoardSnapshotsShema = z.array(BoardSnapshotSchema)
export type BoardSnapshots = z.infer<typeof BoardSnapshotsShema>

// Ids of one-shot migrations already applied per board id (see
// migrateBoardLayoutHeights in mobile-layout.ts), keyed by BoardSnapshot.id.
// Deliberately NOT a field on BoardSnapshot: that schema is loose specifically
// so an old bundle's write-back doesn't drop fields it doesn't recognise, but
// "doesn't drop" only holds until the *next* client old enough to predate the
// field entirely does the same round trip through a strict schema on main —
// which is exactly the population this migration marker has to survive
// during a release window. Living at its own storage key sidesteps that: an
// old bundle never references this key, so it never reads or writes it, so
// it can never strip it. A migration id in this list must never be
// re-applied, even if a later deliberate edit (e.g. the user shrinking a
// widget below the height the migration set) would otherwise look like it
// needs the same bump again.
export const BoardMigrationsSchema = z.record(z.string(), z.array(z.string()))
export type BoardMigrations = z.infer<typeof BoardMigrationsSchema>
