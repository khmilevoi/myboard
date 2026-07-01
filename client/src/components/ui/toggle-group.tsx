import { ToggleGroup as ToggleGroupPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@widget-sdk/lib/utils'
import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

const ToggleGroup = reatomMemo<React.ComponentProps<typeof ToggleGroupPrimitive.Root>>(
  ({ className, children, ...props }) => {
    return (
      <ToggleGroupPrimitive.Root
        data-slot="toggle-group"
        className={cn('group/toggle-group flex w-fit items-center', className)}
        {...props}
      >
        {children}
      </ToggleGroupPrimitive.Root>
    )
  },
  'ToggleGroup',
)

const ToggleGroupItem = reatomMemo<React.ComponentProps<typeof ToggleGroupPrimitive.Item>>(
  ({ className, children, ...props }) => {
    return (
      <ToggleGroupPrimitive.Item
        data-slot="toggle-group-item"
        className={cn(
          'inline-flex items-center justify-center outline-none disabled:pointer-events-none disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {children}
      </ToggleGroupPrimitive.Item>
    )
  },
  'ToggleGroupItem',
)

export { ToggleGroup, ToggleGroupItem }
