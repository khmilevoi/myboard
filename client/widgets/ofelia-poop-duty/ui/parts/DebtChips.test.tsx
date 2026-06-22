// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { DebtBalanceEntry } from '../view-model'

import { DebtChips } from './DebtChips'

const balance: DebtBalanceEntry[] = [
  { person: 'Карина', debt: 8, over: true },
  { person: 'Леша', debt: 0, over: false },
]

describe('DebtChips', () => {
  it('renders a chip per person with the debt count', () => {
    render(<DebtChips balance={balance} />)
    expect(screen.getByText('8')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })

  it('flags chips above the warning threshold', () => {
    render(<DebtChips balance={balance} />)
    expect(screen.getByTestId('debt-chip-Карина')).toHaveAttribute('data-over', 'true')
    expect(screen.getByTestId('debt-chip-Леша')).toHaveAttribute('data-over', 'false')
  })
})