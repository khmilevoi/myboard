// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ActionErrorNote } from './ActionErrorNote'

describe('ActionErrorNote', () => {
  it('renders nothing when there is no message', () => {
    const { container } = render(<ActionErrorNote message={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('announces the message as an alert', () => {
    render(<ActionErrorNote message="Не удалось выполнить действие" />)
    expect(screen.getByRole('alert')).toHaveTextContent('Не удалось выполнить действие')
  })
})
