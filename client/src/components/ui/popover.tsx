import { Popover as PopoverPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@widget-sdk/lib/utils'
import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

const Popover = PopoverPrimitive.Root
const PopoverTrigger = PopoverPrimitive.Trigger
const PopoverAnchor = PopoverPrimitive.Anchor

const PopoverArrow = reatomMemo<React.ComponentProps<typeof PopoverPrimitive.Arrow>>(
  ({ className, ...props }) => {
    return (
      <PopoverPrimitive.Arrow
        data-slot="popover-arrow"
        className={cn('fill-popover', className)}
        {...props}
      />
    )
  },
  'PopoverArrow',
)

const PopoverContent = reatomMemo<React.ComponentProps<typeof PopoverPrimitive.Content>>(
  ({ className, align = 'center', sideOffset = 4, ...props }) => {
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          data-slot="popover-content"
          align={align}
          sideOffset={sideOffset}
          className={cn(
            'z-50 w-72 origin-(--radix-popover-content-transform-origin) rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Portal>
    )
  },
  'PopoverContent',
)

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor, PopoverArrow }
