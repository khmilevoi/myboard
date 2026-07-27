// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { MemberAvatar } from './MemberAvatar'

describe('MemberAvatar', () => {
  it('renders the account initial', () => {
    render(<MemberAvatar author={{ kind: 'account', accountId: 'a1', name: 'Карина' }} />)
    expect(screen.getByTitle('Карина')).toHaveTextContent('К')
  })

  // F17: the account branch used to be the one exception left announced to
  // assistive tech — its initial (or, with an avatar, the image `alt`) was
  // read a second time right before the paired written name, producing
  // things like "Карина отметил(а) Карина". Every other branch here is
  // `aria-hidden`; this one must match.
  it('hides the account initial from assistive tech, same as every other branch', () => {
    const { container } = render(
      <MemberAvatar author={{ kind: 'account', accountId: 'a1', name: 'Карина' }} />,
    )
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('renders the avatar image with an empty alt, so it is not announced twice', () => {
    const { container } = render(
      <MemberAvatar
        author={{ kind: 'account', accountId: 'a1', name: 'Карина', avatarUrl: '/k.png' }}
      />,
    )
    const image = container.querySelector('img')
    expect(image).toHaveAttribute('src', '/k.png')
    expect(image).toHaveAttribute('alt', '')
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
