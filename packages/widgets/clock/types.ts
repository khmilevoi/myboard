import type { InferWidgetEvents, WidgetEventSchemas } from '@shared/widgets/contracts'

export const clockEventSchemas = {} as const satisfies WidgetEventSchemas

export type ClockEvents = InferWidgetEvents<typeof clockEventSchemas>
