import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { HarnessApp, harnessProps } from './harness'

describe('clock harness', () => {
  it('builds real runtime props bound to the dev instance', () => {
    const props = harnessProps()

    expect(props.typeId).toBe('clock')
    expect(typeof props.storage.instance.client.get).toBe('function')
    expect(typeof props.api.invoke).toBe('function')
  })

  it('renders the widget standalone', () => {
    render(<HarnessApp />)
    expect(screen.getByText(/:/)).toBeInTheDocument()
  })
})
