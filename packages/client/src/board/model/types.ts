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

export const BoardSnapshotSchema = z.object({
  id: z.string(),
  name: z.string(),
  instances: z.array(WidgetInstanceSchema),
  layout: z.array(LayoutItemSchema),
})
export type BoardSnapshot = z.infer<typeof BoardSnapshotSchema>

export const BoardSnapshotsShema = z.array(BoardSnapshotSchema)
export type BoardSnapshots = z.infer<typeof BoardSnapshotsShema>
