import type { APIRequestContext } from '@playwright/test'

export type SeedInviteOptions = {
  ttlMs?: number
  maxUses?: number
  label?: string
}

export type SeedInviteResult = {
  token: string
  activateUrl: string
}

/**
 * Seeds a fresh single-use invite through the `/api/test/*` control routes of
 * the calling worker's own stack (relative to `baseURL`, see stack.ts).
 */
export async function seedInvite(
  request: APIRequestContext,
  opts?: SeedInviteOptions,
): Promise<SeedInviteResult> {
  const response = await request.post('/api/test/seed-invite', {
    data: opts ?? {},
  })
  if (!response.ok()) {
    throw new Error(`seed-invite failed with status ${response.status()}: ${await response.text()}`)
  }
  return (await response.json()) as SeedInviteResult
}
