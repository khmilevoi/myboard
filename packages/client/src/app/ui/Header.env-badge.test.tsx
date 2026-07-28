import { context } from '@reatom/core'
import { render, screen } from '@testing-library/react'
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted per file, so this case cannot live in Header.test.tsx
// beside "shows no environment badge in a production build" -- that case must
// keep exercising the real, unmocked production default. currentAppEnv reads
// the __APP_ENV__ build constant, which Vitest always resolves to
// 'production', so proving the badge itself renders needs the module stubbed.
vi.mock('@/shared/app-env/current', () => ({ currentAppEnv: 'dev' }))

import { Header } from './Header'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('Header', () => {
  it('renders the environment badge for a branded environment', () => {
    render(<Header />)
    expect(screen.getByRole('status', { name: 'Окружение: dev' })).toBeInTheDocument()
  })
})
