// @vitest-environment jsdom
import { context } from '@reatom/core'
import { waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { isBoardInteracting } from './board-interaction-model'

beforeEach(() => {
  context.reset()
  delete document.body.dataset.boardInteracting
})

describe('board interaction model', () => {
  it('stores interaction state and mirrors it to the body selection guard', async () => {
    expect(isBoardInteracting()).toBe(false)
    expect(document.body.dataset.boardInteracting).toBeUndefined()

    isBoardInteracting.setTrue()
    expect(isBoardInteracting()).toBe(true)
    await waitFor(() => {
      expect(document.body.dataset.boardInteracting).toBe('true')
    })

    isBoardInteracting.setFalse()
    expect(isBoardInteracting()).toBe(false)
    await waitFor(() => {
      expect(document.body.dataset.boardInteracting).toBeUndefined()
    })
  })
})
