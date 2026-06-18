// @vitest-environment jsdom
import { context } from '@reatom/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  beginBoardInteraction,
  endBoardInteraction,
  isBoardInteracting,
} from './board-interaction-model'

beforeEach(() => {
  context.reset()
  delete document.body.dataset.boardInteracting
})

describe('board interaction model', () => {
  it('stores interaction state and mirrors it to the body selection guard', () => {
    expect(isBoardInteracting()).toBe(false)
    expect(document.body.dataset.boardInteracting).toBeUndefined()

    beginBoardInteraction()
    expect(isBoardInteracting()).toBe(true)
    expect(document.body.dataset.boardInteracting).toBe('true')

    endBoardInteraction()
    expect(isBoardInteracting()).toBe(false)
    expect(document.body.dataset.boardInteracting).toBeUndefined()
  })
})
