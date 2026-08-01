import { render, screen } from '@testing-library/react'

import { HarnessApp, harnessProps } from './harness'

describe('passport-checker harness', () => {
  it('builds real runtime props bound to the dev instance', () => {
    const props = harnessProps()

    expect(props.typeId).toBe('passport-checker')
    expect(typeof props.storage.instance.client.get).toBe('function')
    expect(typeof props.api.invoke).toBe('function')
  })

  it('builds a small tiny-card preview for responsive visual checks', () => {
    const props = harnessProps('tiny', 'small')

    expect(props.tier).toBe('tiny')
    expect(props.mode).toBe('small')
  })

  it('renders the widget standalone', async () => {
    render(<HarnessApp />)
    expect(await screen.findByText('Паспорт')).toBeInTheDocument()
  })
})
