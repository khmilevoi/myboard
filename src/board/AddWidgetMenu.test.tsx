// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { context } from '@reatom/core'
import { fireEvent, render, screen } from '@testing-library/react'
import { instances } from '../board-model/board-model'
import { AddWidgetMenu } from './AddWidgetMenu'

beforeEach(() => {
  context.reset()
  localStorage.clear()
})

describe('AddWidgetMenu', () => {
  it('adds a widget when a catalog item is clicked', () => {
    render(<AddWidgetMenu />)
    expect(instances()).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /add widget/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /clock/i }))
    expect(instances()).toHaveLength(1)
  })
})
