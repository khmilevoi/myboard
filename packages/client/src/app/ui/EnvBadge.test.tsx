import { context } from '@reatom/core'
import { fireEvent, render, screen, within } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'

import { EnvBadge } from './EnvBadge'

beforeEach(() => {
  context.reset()
})

const BUILD = { branch: 'feat/cats-module-rename', commit: '483a2ac' }

describe('EnvBadge', () => {
  it('renders the environment label', () => {
    render(<EnvBadge env="dev" />)
    expect(screen.getByText('dev')).toBeInTheDocument()
  })

  it('renders nothing for production', () => {
    const { container } = render(<EnvBadge env="production" build={BUILD} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the branch name instead of the label on the branch stand', () => {
    render(<EnvBadge env="branch" build={BUILD} />)
    const pill = screen.getByRole('button', {
      name: 'Окружение: branch, ветка feat/cats-module-rename',
    })

    expect(within(pill).getByText('feat/cats-module-rename')).toBeInTheDocument()
    expect(within(pill).queryByText('branch')).not.toBeInTheDocument()
  })

  it('falls back to the label when the branch stand does not know its branch', () => {
    render(<EnvBadge env="branch" />)
    const pill = screen.getByRole('button', { name: 'Окружение: branch' })

    expect(within(pill).getByText('branch')).toBeInTheDocument()
  })

  it('keeps the label on dev even when the build knows its branch', () => {
    render(<EnvBadge env="dev" build={{ branch: 'dev', commit: '6c8ff7c' }} />)
    const pill = screen.getByRole('button', { name: 'Окружение: dev, ветка dev' })

    expect(within(pill).getByText('dev')).toBeInTheDocument()
  })

  // The pill's text is hidden at ≤640px and cut with an ellipsis when long,
  // so the popover is where the full branch and the commit must always be.
  it('opens a popover with the full branch and the commit', () => {
    render(<EnvBadge env="branch" build={BUILD} />)
    fireEvent.click(screen.getByRole('button', { name: /Окружение/ }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Окружение branch')).toBeInTheDocument()
    expect(within(dialog).getByText('feat/cats-module-rename')).toBeInTheDocument()
    expect(within(dialog).getByText('483a2ac')).toBeInTheDocument()
  })

  it('omits the branch row and marks the commit unknown when the build says nothing', () => {
    render(<EnvBadge env="local" />)
    fireEvent.click(screen.getByRole('button', { name: /Окружение/ }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).queryByText('Ветка')).not.toBeInTheDocument()
    expect(within(dialog).getByText('неизвестен')).toBeInTheDocument()
  })
})
