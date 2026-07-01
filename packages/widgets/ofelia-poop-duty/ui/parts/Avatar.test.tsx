// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from './Avatar'

describe('Avatar', () => {
  it('renders the person initial with the matching tone', () => {
    render(<Avatar person="Карина" />)
    const badge = screen.getByText('К')
    expect(badge).toHaveAttribute('data-tone', 'k')
    expect(badge).toHaveAttribute('data-size', 'md')
  })

  it('applies the requested size', () => {
    render(<Avatar person="Леша" size="lg" />)
    const badge = screen.getByText('Л')
    expect(badge).toHaveAttribute('data-tone', 'l')
    expect(badge).toHaveAttribute('data-size', 'lg')
  })

  it('renders with exact pixel size via px prop', () => {
    const { container } = render(<Avatar person="Карина" px={26} />)
    const avatar = container.querySelector('[data-tone="k"]')!
    expect(avatar).toHaveStyle({ width: '26px', height: '26px' })
  })
})
