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
})
