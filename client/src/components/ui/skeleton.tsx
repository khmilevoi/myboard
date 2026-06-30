import * as React from 'react'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@widget-sdk/reatom/reatom-memo'

const Skeleton = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  )
}, 'Skeleton')

export { Skeleton }
