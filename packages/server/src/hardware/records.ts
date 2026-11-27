import { PairingStageSchema, ScanResultSchema } from '@shared/hardware/board-api'
import { BleAddressSchema, HardwareModelSchema } from '@shared/hardware/models'
import {
  ConsentCodeSchema,
  ScaleUserIndexSchema,
  ScaleUserSummarySchema,
} from '@shared/hardware/spike-assumptions'
import { z } from 'zod'

export const GatewayCodeRecordSchema = z.object({
  codeHash: z.string(),
  expiresAt: z.number(),
  failedAttempts: z.number(),
  createdBy: z.string(),
})
export type GatewayCodeRecord = z.infer<typeof GatewayCodeRecordSchema>

/** `tokenHash` never leaves the server. */
export const GatewayRecordSchema = z.object({
  id: z.string(),
  label: z.string(),
  tokenHash: z.string(),
  createdAt: z.number(),
  createdBy: z.string(),
  lastSeenAt: z.number(),
  connectedAt: z.number().nullable(),
  adapter: z.object({ powered: z.boolean() }).nullable(),
  bonded: z.array(z.object({ address: BleAddressSchema, model: HardwareModelSchema })),
})
export type GatewayRecord = z.infer<typeof GatewayRecordSchema>

export const GatewayTokenRecordSchema = z.object({ gatewayId: z.string() })
export type GatewayTokenRecord = z.infer<typeof GatewayTokenRecordSchema>

export const HardwareRecordSchema = z.object({
  id: z.string(),
  gatewayId: z.string().nullable(),
  address: BleAddressSchema,
  model: HardwareModelSchema,
  createdAt: z.number(),
  battery: z.number().nullable(),
  lastReadingAt: z.number().nullable(),
  scaleUsers: z.array(ScaleUserSummarySchema),
})
export type HardwareRecord = z.infer<typeof HardwareRecordSchema>

export const BindingRecordSchema = z.object({
  hardwareId: z.string(),
  index: ScaleUserIndexSchema,
  accountId: z.string(),
  consentCode: ConsentCodeSchema,
  createdAt: z.number(),
  profileRevision: z.number().int(),
  appliedRevision: z.number().int(),
})
export type BindingRecord = z.infer<typeof BindingRecordSchema>

export const ScanRecordSchema = z.object({
  gatewayId: z.string(),
  startedAt: z.number(),
  active: z.boolean(),
  results: z.array(ScanResultSchema),
})
export type ScanRecord = z.infer<typeof ScanRecordSchema>

export const PairingRecordSchema = z.object({
  id: z.string(),
  gatewayId: z.string(),
  address: BleAddressSchema,
  model: HardwareModelSchema,
  stage: PairingStageSchema,
  hardwareId: z.string().nullable(),
})
export type PairingRecord = z.infer<typeof PairingRecordSchema>

export const PendingCommandRecordSchema = z.object({
  id: z.string(),
  type: z.enum(['scaleUser.create', 'scaleUser.attach']),
  gatewayId: z.string(),
  hardwareId: z.string(),
  accountId: z.string(),
  consentCode: ConsentCodeSchema,
  index: z.number().nullable(),
})
export type PendingCommandRecord = z.infer<typeof PendingCommandRecordSchema>
