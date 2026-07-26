// @vitest-environment node
import { describe, expect, it } from 'vitest'

import browser, { makePassportCheckerBrowser, PASSPORT_CHECKER_URL } from './browser'

describe('passport checker browser definition', () => {
  it('exports exactly the check schema and handler for the fixed production URL', () => {
    expect(PASSPORT_CHECKER_URL).toBe('https://pasport.org.ua/solutions/checker')
    expect(Object.keys(browser.schemas)).toEqual(['check'])
    expect(Object.keys(browser.handlers)).toEqual(['check'])
  })

  it('creates a fixture definition without exposing URL as task input', () => {
    const fixture = makePassportCheckerBrowser({
      checkerUrl: 'http://127.0.0.1:3000/solutions/checker',
    })
    expect(Object.keys(fixture.schemas.check.payload.shape)).toEqual([])
  })
})
