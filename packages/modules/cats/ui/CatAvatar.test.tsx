// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CatSummary } from '../model/cats-model'
import { CatAvatar, CatAvatarStack } from './CatAvatar'

const cat = (id: string, name: string, tone: CatSummary['tone']): CatSummary => ({
  id,
  name,
  avatar: null,
  litterId: 'ofelia',
  tone,
})

describe('CatAvatar', () => {
  it('shows the first letter, upper-cased, hidden from assistive tech', () => {
    const { container } = render(<CatAvatar name="офелия" tone="a" photoUrl={null} size="header" />)
    const avatar = container.firstElementChild
    expect(avatar).toHaveTextContent('О')
    expect(avatar).toHaveAttribute('aria-hidden', 'true')
    expect(avatar).toHaveAttribute('data-tone', 'a')
    expect(avatar).toHaveAttribute('data-size', 'header')
  })

  it('carries the tone', () => {
    const { container } = render(<CatAvatar name="Буся" tone="b" photoUrl={null} size="list" />)
    expect(container.firstElementChild).toHaveAttribute('data-tone', 'b')
  })

  it('shows the photo with an empty alt instead of the letter', () => {
    const { container } = render(
      <CatAvatar name="Офелия" tone="a" photoUrl="/files/abc" size="profile" />,
    )
    const image = container.querySelector('img')
    expect(image).toHaveAttribute('src', '/files/abc')
    expect(image).toHaveAttribute('alt', '')
    expect(container.firstElementChild).not.toHaveTextContent('О')
  })

  it("shows '?' for a blank name", () => {
    const { container } = render(<CatAvatar name="  " tone="a" photoUrl={null} size="badge" />)
    expect(container.firstElementChild).toHaveTextContent('?')
  })
})

describe('CatAvatarStack', () => {
  it('draws one avatar per cat, in order', () => {
    const { container } = render(
      <CatAvatarStack
        cats={[cat('ofelia', 'Офелия', 'a'), cat('busya', 'Буся', 'b')]}
        size="menu"
      />,
    )
    const avatars = container.querySelectorAll('[data-tone]')
    expect([...avatars].map((avatar) => avatar.textContent)).toEqual(['О', 'Б'])
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })
})
