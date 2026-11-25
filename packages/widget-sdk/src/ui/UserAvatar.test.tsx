import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { getAvatarInitials, getAvatarTone, UserAvatar } from './UserAvatar'

describe('UserAvatar', () => {
  it('uses first and last Unicode initials without exposing an identity key', () => {
    expect(getAvatarInitials('  ёлка   Мария Иванова ')).toBe('ЁИ')
    expect(getAvatarInitials('李 小龍')).toBe('李小')
    expect(getAvatarInitials('Лёша')).toBe('Л')
    render(<UserAvatar name="Анна Иванова" identityKey="private-account-key" />)
    const avatar = screen.getByRole('img', { name: 'Анна Иванова' })
    expect(avatar).toHaveTextContent('АИ')
    expect(avatar.outerHTML).not.toContain('private-account-key')
  })

  it('keeps the identity colour stable when a display name changes', () => {
    const { rerender } = render(<UserAvatar name="Анна" identityKey="account-1" />)
    const tone = screen.getByRole('img').getAttribute('data-tone')
    rerender(<UserAvatar name="Анна Иванова" identityKey="account-1" />)
    expect(screen.getByRole('img')).toHaveAttribute('data-tone', tone)
    expect(
      new Set(Array.from({ length: 50 }, (_, i) => getAvatarTone(`a${i}`))).size,
    ).toBeGreaterThan(1)
  })

  it('labels an unknown user safely and does not load an empty image URL', () => {
    const { container } = render(<UserAvatar name="   " avatarUrl=" " identityKey="secret-id" />)
    expect(screen.getByRole('img', { name: 'Неизвестный пользователь' })).toHaveTextContent('?')
    expect(container.querySelector('img')).toBeNull()
    expect(container.textContent).not.toContain('secret-id')
  })

  it('hides a decorative avatar when the name is already written beside it', () => {
    const { container } = render(<UserAvatar name="Анна" decorative />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('falls back after image failure and retries when the image or identity changes', () => {
    const { container, rerender } = render(
      <UserAvatar name="Анна Иванова" identityKey="a" avatarUrl="/a.png" />,
    )
    let image = container.querySelector('img')!
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer')
    fireEvent.error(image)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByRole('img', { name: 'Анна Иванова' })).toHaveTextContent('АИ')

    rerender(<UserAvatar name="Анна Иванова" identityKey="a" avatarUrl="/new.png" />)
    image = container.querySelector('img')!
    expect(image).toHaveAttribute('src', '/new.png')
    fireEvent.error(image)
    rerender(<UserAvatar name="Лев Орлов" identityKey="b" avatarUrl="/new.png" />)
    expect(container.querySelector('img')).toHaveAttribute('src', '/new.png')
    expect(screen.getByRole('img', { name: 'Лев Орлов' })).toBeInTheDocument()
  })
})
