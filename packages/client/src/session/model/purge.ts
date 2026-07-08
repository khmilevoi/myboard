import { purgeLocalData } from 'widget-runtime'

/**
 * Local-data hygiene on logout: Dexie board data, every Cache Storage cache
 * (the PWA precache included), and the service worker registration. Runs
 * best-effort — a failed step must not block the logout redirect.
 */
export async function purgeLocalSession(): Promise<void> {
  await purgeLocalData().catch(() => undefined)

  if (typeof caches !== 'undefined') {
    const keys = await caches.keys().catch(() => [] as string[])
    await Promise.all(keys.map((key) => caches.delete(key).catch(() => false)))
  }

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(() => [])
    await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)))
  }
}
