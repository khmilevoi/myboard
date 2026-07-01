import { describe, expect, it } from 'vitest'

import { apiProxy } from './vite-dev-config'

describe('apiProxy', () => {
  it('defaults to the local storage server and rewrites origin', () => {
    const proxy = apiProxy()
    expect(proxy['/api']).toMatchObject({ target: 'http://localhost:8787', changeOrigin: true })
  })

  it('honours an explicit target override', () => {
    expect(apiProxy('http://example.test:9000')['/api'].target).toBe('http://example.test:9000')
  })
})
