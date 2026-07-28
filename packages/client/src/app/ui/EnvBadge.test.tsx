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

  it('keeps the label text in its own element, separate from the dot', () => {
    render(<EnvBadge env="dev" />)
    const label = screen.getByText('dev')
    const dot = screen.getByRole('status').querySelector('[aria-hidden="true"]')

    expect(label.tagName).toBe('SPAN')
    expect(label).not.toBe(dot)
  })

  it('keeps announcing the environment via aria-label, independent of the label text -- this is what keeps the <=640px dot-only state announced, since CSS.module media queries do not evaluate in jsdom', () => {
    render(<EnvBadge env="branch" />)
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Окружение: branch')
  })
})
