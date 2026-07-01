import { expect, test } from '@playwright/test'

const REMOTE_PATHS = [
  '/widgets/clock/remoteEntry.js',
  '/widgets/ofelia-poop-duty/remoteEntry.js',
] as const

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

test('the host artifact serves both federation remote entries as JavaScript', async ({
  request,
}) => {
  for (const path of REMOTE_PATHS) {
    const response = await request.get(path)
    expect(response.ok(), `${path} should exist`).toBe(true)
    expect(response.headers()['content-type']).toContain('javascript')
    expect(await response.text()).not.toContain('<!doctype html>')
  }
})

test('the copied Clock standalone harness renders from the host artifact', async ({ page }) => {
  await page.goto('/widgets/clock/')

  await expect(page.getByText(/:/)).toBeVisible()
})

test('Workbox precaches both remote entries with release revisions', async ({ page, request }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })

  const serviceWorker = await request.get('/sw.js')
  expect(serviceWorker.ok()).toBe(true)
  const source = await serviceWorker.text()

  for (const path of REMOTE_PATHS) {
    const relativePath = escapeRegex(path.slice(1))
    const revisionedEntry = new RegExp(
      `\\{(?=[^{}]*url:"${relativePath}")(?=[^{}]*revision:"[^"]+")[^{}]*\\}`,
    )
    expect(source).toMatch(revisionedEntry)
  }

  await expect
    .poll(async () => {
      return page.evaluate(async () => {
        const cacheNames = await caches.keys()
        const requests = (
          await Promise.all(
            cacheNames.map(async (cacheName) => (await caches.open(cacheName)).keys()),
          )
        ).flat()
        return requests.map((request) => new URL(request.url).pathname)
      })
    })
    .toEqual(expect.arrayContaining([...REMOTE_PATHS]))
})
