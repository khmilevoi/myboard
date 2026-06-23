import { Tabs as TabsPrimitive } from 'radix-ui'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Tabs = reatomMemo<React.ComponentProps<typeof TabsPrimitive.Root>>(
  ({ className, children, ...props }) => {
    return (
      <TabsPrimitive.Root
        data-slot="tabs"
        className={cn('flex flex-col gap-2', className)}
        {...props}
      >
        {children}
      </TabsPrimitive.Root>
    )
  },
  'Tabs',
)

const TabsList = reatomMemo<React.ComponentProps<typeof TabsPrimitive.List>>(
  ({ className, children, ...props }) => {
    return (
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(
          'inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground',
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.List>
    )
  },
  'TabsList',
)

const TabsTrigger = reatomMemo<React.ComponentProps<typeof TabsPrimitive.Trigger>>(
  ({ className, children, ...props }) => {
    return (
      <TabsPrimitive.Trigger
        data-slot="tabs-trigger"
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
          className,
        )}
        {...props}
      >
        {children}
      </TabsPrimitive.Trigger>
    )
  },
  'TabsTrigger',
)

const TabsContent = reatomMemo<React.ComponentProps<typeof TabsPrimitive.Content>>(
  ({ className, children, ...props }) => {
    return (
      <TabsPrimitive.Content data-slot="tabs-content" className={cn('outline-none', className)} {...props}>
        {children}
      </TabsPrimitive.Content>
    )
  },
  'TabsContent',
)

export { Tabs, TabsList, TabsTrigger, TabsContent }
