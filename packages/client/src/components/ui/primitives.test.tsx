import { fireEvent, render, screen, waitFor } from '@testing-library/react'
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

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
})
