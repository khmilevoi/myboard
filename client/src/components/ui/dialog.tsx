import * as React from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import { reatomMemo } from '@/shared/reatom/reatom-memo'

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogPortal = DialogPrimitive.Portal
const DialogClose = DialogPrimitive.Close

const DialogOverlay = reatomMemo<React.ComponentProps<typeof DialogPrimitive.Overlay>>(
  ({ className, ...props }) => {
    return (
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        className={cn(
          'fixed inset-0 z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
          className,
        )}
        {...props}
      />
    )
  },
  'DialogOverlay',
)

const DialogContent = reatomMemo<
  React.ComponentProps<typeof DialogPrimitive.Content> & { overlayClassName?: string }
>(({ className, overlayClassName, children, ...props }) => {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 bg-card text-card-foreground outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}, 'DialogContent')

const DialogTitle = reatomMemo<React.ComponentProps<typeof DialogPrimitive.Title>>(
  ({ className, ...props }) => {
    return (
      <DialogPrimitive.Title
        data-slot="dialog-title"
        className={cn('text-base leading-none font-semibold', className)}
        {...props}
      />
    )
  },
  'DialogTitle',
)

const DialogDescription = reatomMemo<React.ComponentProps<typeof DialogPrimitive.Description>>(
  ({ className, ...props }) => {
    return (
      <DialogPrimitive.Description
        data-slot="dialog-description"
        className={cn('text-sm text-muted-foreground', className)}
        {...props}
      />
    )
  },
  'DialogDescription',
)

export {
  Dialog,
  DialogTrigger,
  DialogPortal,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
