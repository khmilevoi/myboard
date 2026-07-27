// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetOverlayHistory } from 'widget-runtime'

import { useOverlayBackDismiss } from './use-overlay-back-dismiss'

function goBackTo(depth: number) {
  act(() => {
    history.replaceState({ overlayDepth: depth }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  })
}

function Overlay({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true)
  const requestDismiss = useOverlayBackDismiss(open, () => {
    setOpen(false)
    onClose()
  })

  return (
    <div>
      <span>{open ? 'open' : 'closed'}</span>
      <button onClick={requestDismiss}>dismiss</button>
    </div>
  )
}

beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})

describe('useOverlayBackDismiss', () => {
  it('registers a history entry while the overlay is open', () => {
    render(<Overlay onClose={vi.fn()} />)
    expect(history.state).toEqual({ overlayDepth: 1 })
  })

  it('closes the overlay when the user navigates back', () => {
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} />)

    goBackTo(0)

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })

  it('routes its own dismiss through history rather than closing directly', () => {
    const back = vi.spyOn(history, 'back').mockImplementation(() => undefined)
    const onClose = vi.fn()
    render(<Overlay onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'dismiss' }))

    expect(back).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    back.mockRestore()
  })

  it('registers nothing while the overlay is closed', () => {
    const Closed = () => {
      useOverlayBackDismiss(false, vi.fn())
      return <span>inert</span>
    }
    render(<Closed />)
    expect(history.state).toEqual({})
  })
})

describe('useOverlayBackDismiss under StrictMode', () => {
  it('registers exactly one history entry after StrictMode double-mount settles', async () => {
    render(
      <StrictMode>
        <Overlay onClose={vi.fn()} />
      </StrictMode>,
    )

    await waitFor(
      () => {
        expect(history.state).toEqual({ overlayDepth: 1 })
      },
      { timeout: 100 },
    )
  })

  it('closes the overlay with a single back press after StrictMode double-mount settles', async () => {
    const onClose = vi.fn()
    render(
      <StrictMode>
        <Overlay onClose={onClose} />
      </StrictMode>,
    )

    await waitFor(
      () => {
        expect(history.state).toEqual({ overlayDepth: 1 })
      },
      { timeout: 100 },
    )

    goBackTo(0)

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('closed')).toBeInTheDocument()
  })
})

describe('useOverlayBackDismiss dismiss callback fallback', () => {
  it('calls close directly when entry has been cleared', () => {
    const onClose = vi.fn()
    let capturedDismiss: (() => void) | null = null

    const TestWrapper = () => {
      const [open, setOpen] = useState(true)
      const requestDismiss = useOverlayBackDismiss(open, () => {
        setOpen(false)
        onClose()
      })
      capturedDismiss = requestDismiss

      return (
        <div>
          <span>{open ? 'open' : 'closed'}</span>
        </div>
      )
    }

    const { unmount } = render(<TestWrapper />)

    // Entry is registered
    expect(history.state).toEqual({ overlayDepth: 1 })

    // Unmount the component, clearing the entry
    unmount()

    // Call the dismiss callback after the entry is cleared
    capturedDismiss?.()

    // Fallback close should have been called
    expect(onClose).toHaveBeenCalledOnce()
  })
})
