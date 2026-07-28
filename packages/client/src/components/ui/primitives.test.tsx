import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
// @vitest-environment jsdom
import { useState } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetOverlayHistory } from 'widget-runtime'

import { Badge } from './badge'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu'
import { Input } from './input'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Separator } from './separator'
import { Skeleton } from './skeleton'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

beforeEach(() => {
  resetOverlayHistory()
  history.replaceState({}, '')
})

describe('ui primitives', () => {
  it('renders Input, Badge, Separator and Skeleton', () => {
    render(
      <div>
        <Input placeholder="q" />
        <Badge>x</Badge>
        <Separator />
        <Skeleton className="h-4 w-4" />
      </div>,
    )
    expect(screen.getByPlaceholderText('q')).toBeInTheDocument()
    expect(screen.getByText('x')).toBeInTheDocument()
  })

  it('renders a single-select ToggleGroup', () => {
    render(
      <ToggleGroup type="single" defaultValue="a">
        <ToggleGroupItem value="a" aria-label="opt a">
          A
        </ToggleGroupItem>
      </ToggleGroup>,
    )
    expect(screen.getByRole('radio', { name: 'opt a' })).toBeInTheDocument()
  })

  it('opens a Popover on trigger click', async () => {
    render(
      <Popover>
        <PopoverTrigger>open</PopoverTrigger>
        <PopoverContent>inside</PopoverContent>
      </Popover>,
    )
    fireEvent.click(screen.getByText('open'))
    expect(await screen.findByText('inside')).toBeInTheDocument()
  })

  it('opens a Dialog on trigger click', async () => {
    render(
      <Dialog>
        <DialogTrigger>open dialog</DialogTrigger>
        <DialogContent>
          <DialogTitle>title</DialogTitle>
          body
        </DialogContent>
      </Dialog>,
    )
    fireEvent.click(screen.getByText('open dialog'))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('toggles a DropdownMenu open and closed on trigger click', async () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>open menu</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>first item</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>second item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    )

    expect(screen.queryByText('first item')).not.toBeInTheDocument()

    // Radix's DropdownMenuTrigger opens on pointerdown (not click), matching real user
    // interaction — a plain fireEvent.click never dispatches pointerdown in jsdom.
    fireEvent.pointerDown(screen.getByText('open menu'), { button: 0, ctrlKey: false })
    expect(await screen.findByText('first item')).toBeInTheDocument()
    expect(screen.getByText('second item')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByText('open menu'), { button: 0, ctrlKey: false })
    await waitFor(() => {
      expect(screen.queryByText('first item')).not.toBeInTheDocument()
    })
  })

  it('closes a controlled popover on the platform back gesture', async () => {
    const ControlledPopover = () => {
      const [open, setOpen] = useState(true)
      return (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger>open</PopoverTrigger>
          <PopoverContent>inside</PopoverContent>
        </Popover>
      )
    }

    render(<ControlledPopover />)
    expect(await screen.findByText('inside')).toBeInTheDocument()

    // Dispatched from outside a React event handler, so it must be wrapped in
    // act() or the resulting state update is not flushed before the
    // assertion — see FullscreenOverlay.test.tsx's equivalent case.
    history.replaceState({ overlayDepth: 0 }, '')
    await act(async () => {
      window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    })

    await waitFor(() => expect(screen.queryByText('inside')).not.toBeInTheDocument())
  })
})
