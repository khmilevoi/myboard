import type { APIRequestContext } from '@playwright/test'

export type SeededSession = { accountId: string; credentialId: string; sessionId: string }

/** Playwright request contexts keep Set-Cookie automatically, so one call
 * authenticates every subsequent request (and page.request shares the
 * browser context's cookies). */
export async function seedSession(request: APIRequestContext): Promise<SeededSession> {
  const response = await request.post('/api/test/seed-session')
  if (!response.ok()) throw new Error(`seed-session failed: ${response.status()}`)
  return (await response.json()) as SeededSession
}

export async function expireSessions(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/test/expire-sessions')
  if (!response.ok()) throw new Error(`expire-sessions failed: ${response.status()}`)
}

export async function revokeDeviceViaGate(
  request: APIRequestContext,
  credentialId: string,
): Promise<void> {
  const response = await request.post('/api/test/revoke-device', { data: { credentialId } })
  if (!response.ok()) throw new Error(`revoke-device failed: ${response.status()}`)
}

export async function seedInviteViaGate(request: APIRequestContext): Promise<{ token: string }> {
  const response = await request.post('/api/test/seed-invite', { data: {} })
  if (!response.ok()) throw new Error(`seed-invite failed: ${response.status()}`)
  return (await response.json()) as { token: string }
}
