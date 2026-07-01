// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { defineWidgetClient, reatomMemo } from './index'
import { apiProxy } from './vite'

describe('widget-sdk package entrypoints', () => {
  it('re-exports the stable public helpers', () => {
    expect(typeof defineWidgetClient).toBe('function')
    expect(typeof reatomMemo).toBe('function')
    expect(apiProxy()['/api'].target).toBe('http://localhost:8787')
  })
})
