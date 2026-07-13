// @vitest-environment jsdom
import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import { Shell } from './Shell'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Shell', () => {
  it('renders children inside the card with the brand mark and theme toggle', () => {
    render(
      <Shell>
        <div>BODY CONTENT</div>
      </Shell>,
    )

    expect(screen.getByText('BODY CONTENT')).toBeInTheDocument()
    expect(screen.getByText('myboard')).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Тема' })).toBeInTheDocument()
  })
})
