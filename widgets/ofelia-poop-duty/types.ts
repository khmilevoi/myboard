import type { InferWidgetEvents, WidgetEventSchemas } from '@shared/widgets/contracts'

export const ofeliaEventSchemas = {} as const satisfies WidgetEventSchemas

export type OfeliaEvents = InferWidgetEvents<typeof ofeliaEventSchemas>
