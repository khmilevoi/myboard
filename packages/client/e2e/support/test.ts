import { test as base } from '@playwright/test'

import { startStack, type E2EStack } from './stack.js'

/**
 * The board e2e `test`. Every spec imports it from here, not from
 * `@playwright/test`: it gives each worker its own app stack (see stack.ts)
 * and points `baseURL` — and therefore `page.goto('/')` and `request.post`
 * — at it.
 */
export const test = base.extend<object, { stack: E2EStack }>({
  stack: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright requires the destructuring
    async ({}, use, workerInfo) => {
      const { stack, stop } = await startStack(workerInfo.parallelIndex)
      try {
        await use(stack)
      } finally {
        await stop()
      }
    },
    { scope: 'worker', timeout: 90_000 },
  ],
  baseURL: async ({ stack }, use) => {
    await use(stack.baseURL)
  },
})

export { expect } from '@playwright/test'
export type { APIRequestContext, Page } from '@playwright/test'
