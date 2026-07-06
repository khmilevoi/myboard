import type { CDPSession, Page } from '@playwright/test'

export type VirtualAuthenticator = {
  client: CDPSession
  authenticatorId: string
}

/**
 * Enables the CDP WebAuthn virtual authenticator on the given page so
 * `navigator.credentials.create`/`.get` ceremonies resolve automatically
 * (ctap2, platform/internal transport, resident keys, user verification)
 * without any real hardware or UI prompt.
 */
export async function enableVirtualAuthenticator(page: Page): Promise<VirtualAuthenticator> {
  const client = await page.context().newCDPSession(page)
  await client.send('WebAuthn.enable')
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      automaticPresenceSimulation: true,
      isUserVerified: true,
    },
  })

  return { client, authenticatorId }
}
