// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WidgetFrame } from './WidgetFrame'
import { createWidgetConnection } from './widget-connection'

vi.mock('./widget-connection', () => ({
  createWidgetConnection: vi.fn(),
}))

const handshake = vi.fn()
const close = vi.fn()

vi.mocked(createWidgetConnection).mockReturnValue({
  handshake,
  close,
  send: vi.fn(),
})

beforeEach(() => {
  handshake.mockResolvedValue(undefined)
  handshake.mockClear()
  close.mockClear()
})

describe('WidgetFrame', () => {
  it('renders an iframe whose src carries the entry, mode and instanceId', () => {
    render(<WidgetFrame instanceId="inst-1" typeId="clock" mode="small" />)
    const iframe = screen.getByTitle('clock (inst-1)') as HTMLIFrameElement
    expect(iframe.src).toContain('/widgets/clock/index.html')
    expect(iframe.src).toContain('mode=small')
    expect(iframe.src).toContain('instanceId=inst-1')
  })

  it('shows an error card for an unknown widget type', () => {
    render(<WidgetFrame instanceId="inst-2" typeId="missing" mode="small" />)
    expect(screen.getByText(/widget unavailable/i)).toBeInTheDocument()
  })

  it('starts the handshake when the iframe has already finished loading', async () => {
    const contentDocument = vi
      .spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get')
      .mockReturnValue({ readyState: 'complete' } as Document)
    const contentWindow = vi
      .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue({
        location: {
          href: `${window.location.origin}/widgets/clock/index.html?mode=small&instanceId=inst-3`,
        },
      } as Window)

    render(<WidgetFrame instanceId="inst-3" typeId="clock" mode="small" />)
    await waitFor(() => expect(handshake).toHaveBeenCalledTimes(1))

    contentDocument.mockRestore()
    contentWindow.mockRestore()
  })

  it('does not start the handshake for the initial blank iframe document', async () => {
    const contentDocument = vi
      .spyOn(HTMLIFrameElement.prototype, 'contentDocument', 'get')
      .mockReturnValue({ readyState: 'complete' } as Document)
    const contentWindow = vi
      .spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get')
      .mockReturnValue({ location: { href: 'about:blank' } } as Window)

    render(<WidgetFrame instanceId="inst-4" typeId="clock" mode="small" />)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(handshake).not.toHaveBeenCalled()

    contentDocument.mockRestore()
    contentWindow.mockRestore()
  })
})
