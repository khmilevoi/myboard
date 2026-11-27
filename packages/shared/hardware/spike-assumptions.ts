// Unconfirmed until the hardware spike; change only here.
import { z } from 'zod'

export const PAIRING_PIN_PATTERN = /^\d{6}$/
export const PairingPinSchema = z.string().regex(PAIRING_PIN_PATTERN)
export type PairingPin = z.infer<typeof PairingPinSchema>

export const CONSENT_CODE_DIGITS = 4
export const ConsentCodeSchema = z.string().regex(new RegExp(`^\\d{${CONSENT_CODE_DIGITS}}$`))
export type ConsentCode = z.infer<typeof ConsentCodeSchema>

export const ScaleProfileSchema = z.object({
  heightCm: z.number(),
  birthDate: z.string(),
  sex: z.enum(['male', 'female']),
})
export type ScaleProfile = z.infer<typeof ScaleProfileSchema>

export const SCALE_USER_SLOTS = 8
export const ScaleUserIndexSchema = z.number().int().min(1).max(SCALE_USER_SLOTS)
export type ScaleUserIndex = z.infer<typeof ScaleUserIndexSchema>

export const ScaleUserSummarySchema = z.object({ index: ScaleUserIndexSchema })
export type ScaleUserSummary = z.infer<typeof ScaleUserSummarySchema>

export const SCAN_DURATION_MS = 30_000
