// @vitest-environment jsdom
import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileTabs } from './MobileTabs'
import styles from './MobileTabs.module.css'

describe('MobileTabs', () => {
  const ControlledMobileTabs = ({ onChange }: { onChange: (tab: 'history' | 'comments') => void }) => {
    const [tab, setTab] = useState<'history' | 'comments'>('history')

    return (
      <MobileTabs
        tab={tab}
        onChange={(nextTab) => {
          onChange(nextTab)
          setTab(nextTab)
        }}
      />
    )
  }

  it('renders two tabs', () => {
    render(<MobileTabs tab="history" onChange={vi.fn()} />)

    expect(screen.getByRole('tab', { name: 'История' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Комментарии' })).toBeInTheDocument()
  })

  it('keeps the hidden-by-default root class and merges a parent className', () => {
    const { container } = render(
      <MobileTabs tab="history" onChange={vi.fn()} className="parent-mobile-tabs" />,
    )

    const root = container.querySelector(`.${styles.root}`)
    expect(root).toBeInTheDocument()
    expect(root).toHaveClass(styles.root)
    expect(root).toHaveClass('parent-mobile-tabs')
  })

  it('switches tabs with Radix tab semantics', async () => {
    const onChange = vi.fn()
    render(<ControlledMobileTabs onChange={onChange} />)

    expect(screen.getByRole('tablist', { hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Комментарии' })).toHaveAttribute('aria-selected', 'false')

    const commentsTab = screen.getByRole('tab', { name: 'Комментарии' })
    fireEvent.pointerDown(commentsTab)
    fireEvent.mouseDown(commentsTab)
    fireEvent.pointerUp(commentsTab)
    fireEvent.mouseUp(commentsTab)
    fireEvent.click(commentsTab)

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: 'История' })).toHaveAttribute('aria-selected', 'false')
      expect(screen.getByRole('tab', { name: 'Комментарии' })).toHaveAttribute('aria-selected', 'true')
      expect(onChange).toHaveBeenCalledWith('comments')
    })
  })
})
