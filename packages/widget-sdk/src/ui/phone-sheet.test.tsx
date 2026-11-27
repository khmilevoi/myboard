// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  PhoneSheet,
  PhoneSheetBody,
  PhoneSheetFooter,
  PhoneSheetHeader,
  phoneSheetContentClassName,
} from './phone-sheet'

describe('PhoneSheet', () => {
  it('renders header, body and footer in that order with slots', () => {
    const { container } = render(
      <PhoneSheet className="extra">
        <PhoneSheetHeader>h</PhoneSheetHeader>
        <PhoneSheetBody>b</PhoneSheetBody>
        <PhoneSheetFooter>f</PhoneSheetFooter>
      </PhoneSheet>,
    )
    const frame = container.firstElementChild as HTMLElement
    expect(frame).toHaveClass(phoneSheetContentClassName, 'extra')
    const slots = [...frame.children].map((el) => el.getAttribute('data-slot'))
    expect(slots).toEqual(['phone-sheet-header', 'phone-sheet-body', 'phone-sheet-footer'])
  })

  it('gives the body the scroll class', () => {
    const { container } = render(<PhoneSheetBody>b</PhoneSheetBody>)
    const body = container.querySelector('[data-slot="phone-sheet-body"]')!
    expect(body.className).not.toBe('')
    expect(phoneSheetContentClassName).not.toBe('')
  })
})
