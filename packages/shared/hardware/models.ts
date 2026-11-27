import { z } from 'zod'

export const HARDWARE_MODELS = {
  'beurer-bf950': { label: 'Beurer BF 950', kind: 'scale' },
} as const

export const HardwareModelSchema = z.enum(['beurer-bf950'])
export type HardwareModel = z.infer<typeof HardwareModelSchema>

export const BleAddressSchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[0-9A-F]{2}(:[0-9A-F]{2}){5}$/))
export type BleAddress = z.infer<typeof BleAddressSchema>
