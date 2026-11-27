import { z } from 'zod'

import { BleAddressSchema, HardwareModelSchema } from './models'
import {
  ConsentCodeSchema,
  PairingPinSchema,
  ScaleProfileSchema,
  ScaleUserIndexSchema,
  ScaleUserSummarySchema,
} from './spike-assumptions'

export const GatewayRegisterBodySchema = z.object({
  code: z.string(),
  label: z.string().trim().min(1).max(60),
})
export type GatewayRegisterBody = z.infer<typeof GatewayRegisterBodySchema>

export const GatewayRegisterResponseSchema = z.object({ gatewayId: z.string(), token: z.string() })
export type GatewayRegisterResponse = z.infer<typeof GatewayRegisterResponseSchema>

const id = z.string()

export const GatewayCommandSchema = z.discriminatedUnion('type', [
  z.object({ id, type: z.literal('scan.start'), durationMs: z.number() }),
  z.object({ id, type: z.literal('scan.stop') }),
  z.object({
    id,
    type: z.literal('pair'),
    pairingId: z.string(),
    address: BleAddressSchema,
    model: HardwareModelSchema,
  }),
  z.object({ id, type: z.literal('pairing.pin'), pairingId: z.string(), pin: PairingPinSchema }),
  z.object({
    id,
    type: z.literal('scaleUser.create'),
    hardwareId: z.string(),
    address: BleAddressSchema,
    consentCode: ConsentCodeSchema,
    profile: ScaleProfileSchema,
  }),
  z.object({
    id,
    type: z.literal('scaleUser.attach'),
    hardwareId: z.string(),
    address: BleAddressSchema,
    index: ScaleUserIndexSchema,
    consentCode: ConsentCodeSchema,
  }),
  z.object({
    id,
    type: z.literal('scaleUser.update'),
    hardwareId: z.string(),
    address: BleAddressSchema,
    index: ScaleUserIndexSchema,
    consentCode: ConsentCodeSchema,
    profile: ScaleProfileSchema,
    revision: z.number().int().min(1),
  }),
  z.object({ id, type: z.literal('unpair'), hardwareId: z.string(), address: BleAddressSchema }),
  z.object({
    id,
    type: z.literal('bindings.sync'),
    bindings: z.array(
      z.object({
        hardwareId: z.string(),
        address: BleAddressSchema,
        model: HardwareModelSchema,
        index: ScaleUserIndexSchema,
        consentCode: ConsentCodeSchema,
      }),
    ),
  }),
])
export type GatewayCommand = z.infer<typeof GatewayCommandSchema>

export const GatewayEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heartbeat'), adapter: z.object({ powered: z.boolean() }) }),
  z.object({
    type: z.literal('bonded'),
    hardware: z.array(z.object({ address: BleAddressSchema, model: HardwareModelSchema })),
  }),
  z.object({
    type: z.literal('scan.result'),
    address: BleAddressSchema,
    name: z.string().max(64),
    rssi: z.number().int(),
    model: HardwareModelSchema,
  }),
  z.object({ type: z.literal('scan.finished') }),
  z.object({
    type: z.literal('pairing.progress'),
    pairingId: z.string(),
    stage: z.enum(['pin_required', 'pin_rejected', 'bonded', 'failed']),
    reason: z.string().max(64).optional(),
  }),
  z.object({
    type: z.literal('scaleUsers'),
    hardwareId: z.string(),
    users: z.array(ScaleUserSummarySchema),
  }),
  z.object({
    type: z.literal('battery'),
    hardwareId: z.string(),
    percent: z.number().int().min(0).max(100),
  }),
  z.object({
    type: z.literal('scaleUser.created'),
    commandId: z.string(),
    index: ScaleUserIndexSchema,
  }),
  z.object({ type: z.literal('scaleUser.attached'), commandId: z.string() }),
  z.object({
    type: z.literal('scaleUser.updated'),
    hardwareId: z.string(),
    index: ScaleUserIndexSchema,
    revision: z.number().int(),
  }),
  z.object({
    type: z.literal('command.failed'),
    commandId: z.string(),
    reason: z.string().max(64),
  }),
])
export type GatewayEvent = z.infer<typeof GatewayEventSchema>

export const GatewayEventsBodySchema = z.object({
  events: z.array(GatewayEventSchema).min(1).max(50),
})
export type GatewayEventsBody = z.infer<typeof GatewayEventsBodySchema>

export const GatewayReadingSchema = z.object({
  ref: z.string().min(1).max(100),
  hardwareId: z.string(),
  scaleUserIndex: ScaleUserIndexSchema,
  takenAt: z.number().int().min(0),
  // Loose on purpose: the server validates metrics through the health module.
  metrics: z.record(z.string(), z.object({ value: z.number(), unit: z.string() })),
})
export type GatewayReading = z.infer<typeof GatewayReadingSchema>

export const GatewayReadingsBodySchema = z.object({
  readings: z.array(GatewayReadingSchema).min(1).max(100),
})
export type GatewayReadingsBody = z.infer<typeof GatewayReadingsBodySchema>

export const ReadingStatusSchema = z.enum(['stored', 'duplicate', 'unbound', 'rejected', 'failed'])
export type ReadingStatus = z.infer<typeof ReadingStatusSchema>

export const GatewayReadingsResponseSchema = z.object({
  results: z.array(z.object({ ref: z.string(), status: ReadingStatusSchema })),
})
export type GatewayReadingsResponse = z.infer<typeof GatewayReadingsResponseSchema>

export const ACKED_READING_STATUSES: readonly ReadingStatus[] = ReadingStatusSchema.options.filter(
  (status) => status !== 'failed',
)
