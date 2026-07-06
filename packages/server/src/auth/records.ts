import { JSONParseError, safeParse } from '@shared/json'
import { z } from 'zod'

import type { ValkeyOps } from '../storage/valkey'

export const InviteRecordSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  maxUses: z.number(),
  uses: z.number(),
  usedAt: z.number().optional(),
  label: z.string().optional(),
  createdBy: z.string().optional(),
  failedAttempts: z.number(),
})
export type InviteRecord = z.infer<typeof InviteRecordSchema>

export const AccountRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  inviteId: z.string(),
  deviceLimit: z.number(),
})
export type AccountRecord = z.infer<typeof AccountRecordSchema>

export const DeviceRecordSchema = z.object({
  credentialId: z.string(),
  publicKey: z.string(),
  signCount: z.number(),
  transports: z.array(z.string()).optional(),
  label: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  disabled: z.boolean(),
  accountId: z.string(),
  status: z.enum(['active', 'pending']),
  addedVia: z.enum(['invite', 'add-token']),
  inviteId: z.string().optional(),
})
export type DeviceRecord = z.infer<typeof DeviceRecordSchema>

export const SessionRecordSchema = z.object({
  sessionId: z.string(),
  accountId: z.string(),
  credentialId: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  absoluteExpiresAt: z.number(),
  lastSeenAt: z.number(),
  ip: z.string().optional(),
  ua: z.string().optional(),
})
export type SessionRecord = z.infer<typeof SessionRecordSchema>

export const ChallengeRecordSchema = z.object({
  challengeId: z.string(),
  challenge: z.string(),
  type: z.enum(['reg', 'auth', 'add-device']),
  expiresAt: z.number(),
  inviteHash: z.string().optional(),
  accountId: z.string().optional(),
})
export type ChallengeRecord = z.infer<typeof ChallengeRecordSchema>

export const AddTokenRecordSchema = z.object({
  accountId: z.string(),
  expiresAt: z.number(),
  failedAttempts: z.number(),
})
export type AddTokenRecord = z.infer<typeof AddTokenRecordSchema>

export const PendingTicketRecordSchema = z.object({
  ticketId: z.string(),
  credentialId: z.string(),
  accountId: z.string(),
  expiresAt: z.number(),
})
export type PendingTicketRecord = z.infer<typeof PendingTicketRecordSchema>

export function inviteKey(hash: string): string {
  return `invite:${hash}`
}

export function accountKey(id: string): string {
  return `account:${id}`
}

export function accountDevicesKey(id: string): string {
  return `account:${id}:devices`
}

export function deviceKey(credId: string): string {
  return `device:${credId}`
}

export function sessionKey(id: string): string {
  return `session:${id}`
}

export function challengeKey(id: string): string {
  return `wachal:${id}`
}

export function addTokenKey(hash: string): string {
  return `deviceadd:${hash}`
}

export function pendingKey(id: string): string {
  return `pending:${id}`
}

export async function getJson<T>(
  ops: ValkeyOps,
  key: string,
  schema: z.ZodType<T>,
): Promise<T | null | Error> {
  const raw = await ops.get(key)
  if (raw === null) return null

  const parsed = safeParse(raw)
  if (parsed instanceof JSONParseError) return parsed

  const result = schema.safeParse(parsed)
  if (!result.success) return result.error
  return result.data
}

export async function setJson(
  ops: ValkeyOps,
  key: string,
  value: unknown,
  ttlMs?: number,
): Promise<void> {
  await ops.set(key, JSON.stringify(value), ttlMs)
}
