// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ofeliaContext, useOfelia } from './ofelia-context'
import { makeOfeliaValue } from './ofelia.fixture'

function Probe() {
  const { view } = useOfelia()
  return <span>{view.selected()?.person}</span>
}

describe('useOfelia', () => {
  it('throws when used outside a provider', () => {
    expect(() => render(<Probe />)).toThrow('OfeliaContext is not available')
  })

  it('exposes the provided value', () => {
    render(
      <ofeliaContext.Provider value={makeOfeliaValue()}>
        <Probe />
      </ofeliaContext.Provider>,
    )
    expect(screen.getByText('Карина')).toBeInTheDocument()
  })
})
