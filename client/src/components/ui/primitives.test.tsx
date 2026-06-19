// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { Input } from './input'
import { Badge } from './badge'
import { Separator } from './separator'
import { Skeleton } from './skeleton'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'
import { Popover, PopoverContent, PopoverTrigger } from './popover'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './dialog'

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
})
