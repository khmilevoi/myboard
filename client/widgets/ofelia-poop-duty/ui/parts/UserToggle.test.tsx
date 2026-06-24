// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { UserToggle } from './UserToggle'

describe('UserToggle', () => {
  it('marks the active person as pressed', () => {
    render(<UserToggle value="Карина" onChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Карина/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Леша/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('calls onChange with the clicked person', () => {
    const onChange = vi.fn()
    render(<UserToggle value="Карина" onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /Леша/ }))
    expect(onChange).toHaveBeenCalledWith('Леша')
  })
})
