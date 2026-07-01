// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ofeliaContext, useOfelia } from './ofelia-context'
import { makeOfeliaValue } from './ofelia.fixture'

function Probe() {
  const { currentUser } = useOfelia()
  return <span>{currentUser()}</span>
}

describe('useOfelia', () => {
  it('throws when used outside a provider', () => {
    expect(() => render(<Probe />)).toThrow('OfeliaContext is not available')
  })

  it('exposes the provided value', () => {
    render(
      <ofeliaContext.Provider value={makeOfeliaValue({ currentUser: 'Леша' })}>
        <Probe />
      </ofeliaContext.Provider>,
    )
    expect(screen.getByText('Леша')).toBeInTheDocument()
  })
})
