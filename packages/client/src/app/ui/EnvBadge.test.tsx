import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { EnvBadge } from './EnvBadge'

beforeEach(() => {
  context.reset()
})

describe('EnvBadge', () => {
  it('renders the environment label', () => {
    render(<EnvBadge env="dev" />)
    expect(screen.getByText('dev')).toBeInTheDocument()
  })

  it('labels itself for assistive technology', () => {
    render(<EnvBadge env="branch" />)
    expect(screen.getByRole('status', { name: 'Окружение: branch' })).toBeInTheDocument()
  })

  it('renders nothing for production', () => {
    const { container } = render(<EnvBadge env="production" />)
    expect(container).toBeEmptyDOMElement()
  })

  // getByText matches on an element's direct text-node children, and returns
  // the closest such element -- if the label were reverted to bare text
  // inside .badge, getByText('dev') would resolve to the pill itself (also a
  // <span>), so comparing against the dot (also not the pill) would pass on
  // both the old and new markup. Compare against the outer pill instead:
  // that's the one element getByText can resolve to on the old markup but
  // never on the new one.
  it('keeps the label text in its own element, nested inside the pill', () => {
    render(<EnvBadge env="dev" />)
    const pill = screen.getByRole('status')
    const label = screen.getByText('dev')

    expect(label.tagName).toBe('SPAN')
    expect(label).not.toBe(pill)
    expect(pill).toContainElement(label)
  })
})
