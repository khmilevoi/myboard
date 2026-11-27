import { z } from 'zod'

import { BleAddressSchema, HardwareModelSchema } from './models'
import { ConsentCodeSchema, PairingPinSchema, ScaleUserIndexSchema } from './spike-assumptions'

/** The SSE frame key for hardware events; never a stored key. */
export const HARDWARE_EVENTS_KEY = 'hw:events'

export const ScanResultSchema = z.object({
  address: BleAddressSchema,
  name: z.string(),
  rssi: z.number().int(),
  model: HardwareModelSchema,
})
export type ScanResult = z.infer<typeof ScanResultSchema>

export const HardwareSnapshotSchema = z.object({
  gateways: z.array(
    z
      .object({
        id: z.string(),
        label: z.string(),
        online: z.boolean(),
        lastSeenAt: z.number(),
        connectedAt: z.number().nullable(),
        adapterPowered: z.boolean().nullable(),
        scan: z
          .object({
            active: z.boolean(),
            startedAt: z.number(),
            results: z.array(ScanResultSchema),
          })
          .nullable(),
        bondedNotAdopted: z.array(
          z.object({ address: BleAddressSchema, model: HardwareModelSchema }),
        ),
      })
      .strict(),
  ),
  hardware: z.array(
    z
      .object({
        id: z.string(),
        gatewayId: z.string().nullable(),
        model: HardwareModelSchema,
        address: BleAddressSchema,
        battery: z.number().nullable(),
        lastReadingAt: z.number().nullable(),
        profiles: z.array(
          z.object({ index: ScaleUserIndexSchema, binding: z.enum(['mine', 'other', 'none']) }),
        ),
      })
      .strict(),
  ),
})
export type HardwareSnapshot = z.infer<typeof HardwareSnapshotSchema>

export const PairingStageSchema = z.enum([
  'connecting',
  'pin_required',
  'pin_rejected',
  'bonded',
  'failed',
])
export type PairingStage = z.infer<typeof PairingStageSchema>

export const HardwareBoardEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('changed') }),
  z.object({ type: z.literal('scan.result'), gatewayId: z.string(), result: ScanResultSchema }),
  z.object({ type: z.literal('scan.finished'), gatewayId: z.string() }),
  z.object({
    type: z.literal('pairing'),
    pairingId: z.string(),
    stage: PairingStageSchema,
    hardwareId: z.string().nullable(),
    reason: z.string().nullable(),
  }),
  z.object({
    type: z.literal('command'),
    commandId: z.string(),
    ok: z.boolean(),
    reason: z.string().nullable(),
  }),
])
export type HardwareBoardEvent = z.infer<typeof HardwareBoardEventSchema>

export const MintCodeResponseSchema = z.object({ code: z.string(), expiresAt: z.number() })
export type MintCodeResponse = z.infer<typeof MintCodeResponseSchema>

export const ScanBodySchema = z.object({ action: z.enum(['start', 'stop']) })
export type ScanBody = z.infer<typeof ScanBodySchema>

export const PairBodySchema = z.object({ address: BleAddressSchema })
export type PairBody = z.infer<typeof PairBodySchema>

export const PairResponseSchema = z.object({ pairingId: z.string() })
export type PairResponse = z.infer<typeof PairResponseSchema>

export const PinBodySchema = z.object({ pin: PairingPinSchema })
export type PinBody = z.infer<typeof PinBodySchema>

export const AdoptBodySchema = z.object({ address: BleAddressSchema })
export type AdoptBody = z.infer<typeof AdoptBodySchema>

export const AdoptResponseSchema = z.object({ hardwareId: z.string() })
export type AdoptResponse = z.infer<typeof AdoptResponseSchema>

export const ProfileBodySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('create') }),
  z.object({
    mode: z.literal('attach'),
    index: ScaleUserIndexSchema,
    consentCode: ConsentCodeSchema,
  }),
])
export type ProfileBody = z.infer<typeof ProfileBodySchema>

export const CommandAcceptedSchema = z.object({ commandId: z.string() })
export type CommandAccepted = z.infer<typeof CommandAcceptedSchema>

export const ConsentCodeResponseSchema = z.object({ consentCode: ConsentCodeSchema })
export type ConsentCodeResponse = z.infer<typeof ConsentCodeResponseSchema>
