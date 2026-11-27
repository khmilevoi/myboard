import { CheckIcon } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'

const DropdownMenu = DropdownMenuPrimitive.Root
const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuContent = reatomMemo<React.ComponentProps<typeof DropdownMenuPrimitive.Content>>(
  ({ className, sideOffset = 4, ...props }) => {
    return (
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          data-slot="dropdown-menu-content"
          sideOffset={sideOffset}
          className={cn(
            'z-50 min-w-[8rem] origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            className,
          )}
          {...props}
        />
      </DropdownMenuPrimitive.Portal>
    )
  },
  'DropdownMenuContent',
)

const DropdownMenuItem = reatomMemo<
  React.ComponentProps<typeof DropdownMenuPrimitive.Item> & { inset?: boolean }
>(({ className, inset, ...props }) => {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8',
        className,
      )}
      {...props}
    />
  )
}, 'DropdownMenuItem')

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

/** A single-choice item; the check marks the one whose `value` the group holds. */
const DropdownMenuRadioItem = reatomMemo<
  React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }) => {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        'relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <span
        data-slot="dropdown-menu-radio-item-indicator"
        className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center"
      >
        <DropdownMenuPrimitive.ItemIndicator>
          <CheckIcon className="size-4" aria-hidden />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
    </DropdownMenuPrimitive.RadioItem>
  )
}, 'DropdownMenuRadioItem')

const DropdownMenuSeparator = reatomMemo<
  React.ComponentProps<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }) => {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}, 'DropdownMenuSeparator')

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
}
