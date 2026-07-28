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

// A hand-built PopStateEvent cannot tell one registered entry from two that
// happen to carry the same depth — it never traverses, so it always lands on
// the depth the test names. These drive a real back press instead, which lands
// on whatever entry the double-mount actually left behind.
describe('useOverlayBackDismiss under StrictMode — real history traversal', () => {
  // One flush task plus jsdom's two-task traversal, with slack.
  const settle = async (): Promise<void> => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
  }

  it('does not close itself after the double-mount, with no user action', async () => {
    const onClose = vi.fn()
    render(
      <StrictMode>
        <Overlay onClose={onClose} />
      </StrictMode>,
    )

    await settle()

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('open')).toBeInTheDocument()
    expect(history.state).toEqual({ overlayDepth: 1 })
  })

  it('closes on one real back press after the double-mount settles', async () => {
    // The entry the back press must land on, owned by this test.
    history.pushState({}, '')

    const onClose = vi.fn()
    render(
      <StrictMode>
        <Overlay onClose={onClose} />
      </StrictMode>,
    )

    await settle()
    expect(history.state).toEqual({ overlayDepth: 1 })

    history.back()
    await settle()

    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByText('closed')).toBeInTheDocument()
    expect(history.state).toEqual({})
  })
})

describe('useOverlayBackDismiss dismiss callback fallback', () => {
  it('calls close directly when entry has been cleared', () => {
    const onClose = vi.fn()
    // Held on an object rather than a `let`: control-flow analysis never sees
    // the assignment inside the component, and narrows a `let` to `never`.
    const captured: { dismiss: (() => void) | null } = { dismiss: null }

    const TestWrapper = () => {
      const [open, setOpen] = useState(true)
      const requestDismiss = useOverlayBackDismiss(open, () => {
        setOpen(false)
        onClose()
      })
      captured.dismiss = requestDismiss

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
    captured.dismiss?.()

    // Fallback close should have been called
    expect(onClose).toHaveBeenCalledOnce()
  })
})
