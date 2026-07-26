// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MemberAvatar } from './MemberAvatar'

describe('MemberAvatar', () => {
  it('renders the account initial', () => {
    render(<MemberAvatar author={{ kind: 'account', accountId: 'a1', name: 'Карина' }} />)
    expect(screen.getByTitle('Карина')).toHaveTextContent('К')
  })

  it('renders the avatar image when the directory has one', () => {
    render(
      <MemberAvatar
        author={{ kind: 'account', accountId: 'a1', name: 'Карина', avatarUrl: '/k.png' }}
      />,
    )
    expect(screen.getByRole('img', { name: 'Карина' })).toHaveAttribute('src', '/k.png')
  })

  it('marks the viewer', () => {
    const { container } = render(
      <MemberAvatar author={{ kind: 'account', accountId: 'a1', name: 'Карина' }} isViewer />,
    )
    expect(container.firstElementChild).toHaveAttribute('data-viewer', 'true')
  })

  it('falls back to a duty circle for a legacy author', () => {
    const { container } = render(<MemberAvatar author={{ kind: 'person', person: 'Леша' }} />)
    expect(container.firstElementChild).toHaveAttribute('data-kind', 'person')
    expect(screen.getByText('Л')).toBeInTheDocument()
  })

  it('renders a placeholder for an unknown author', () => {
    const { container } = render(<MemberAvatar author={{ kind: 'unknown' }} />)
    expect(container.firstElementChild).toHaveAttribute('data-kind', 'unknown')
    expect(screen.getByText('?')).toBeInTheDocument()
  })

  it('marks the system author', () => {
    const { container } = render(<MemberAvatar author={{ kind: 'system' }} />)

    expect(container.firstElementChild).toHaveAttribute('data-kind', 'system')
  })
})
