import type { APIRequestContext } from '@playwright/test'

const TEST_SERVER_URL = 'http://localhost:8787'

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
 * Seeds a fresh single-use invite directly against the test-server's
 * `/api/test/*` control routes (bypassing the preview server's proxy since
 * this is test-only infrastructure, not part of the app under test).
 */
export async function seedInvite(
  request: APIRequestContext,
  opts?: SeedInviteOptions,
): Promise<SeedInviteResult> {
  const response = await request.post(`${TEST_SERVER_URL}/api/test/seed-invite`, {
    data: opts ?? {},
  })
  if (!response.ok()) {
    throw new Error(`seed-invite failed with status ${response.status()}: ${await response.text()}`)
  }
  return (await response.json()) as SeedInviteResult
}
