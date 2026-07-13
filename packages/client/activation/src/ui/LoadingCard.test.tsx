// @vitest-environment jsdom
import { context } from '@reatom/core'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { LoadingCard } from './LoadingCard'

beforeEach(() => context.reset())

describe('LoadingCard', () => {
  it('renders a spinner element', () => {
    const { container } = render(<LoadingCard />)
    expect(container.querySelector('span[aria-hidden]')).not.toBeNull()
  })
})
