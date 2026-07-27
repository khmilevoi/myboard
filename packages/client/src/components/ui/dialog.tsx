import { Dialog as DialogPrimitive } from 'radix-ui'
import * as React from 'react'
import { useOverlayBackDismiss } from 'widget-sdk/hooks/use-overlay-back-dismiss'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

type DialogRootProps = React.ComponentProps<typeof DialogPrimitive.Root>

// Split out because the hook cannot sit behind the `open === undefined` branch
// below. Every close request is routed into `requestDismiss`, which goes
// through history; `popstate` is what eventually calls `onOpenChange(false)`.
const ControlledDialog = reatomMemo<DialogRootProps & { open: boolean }>(
  ({ open, onOpenChange, ...props }) => {
    const requestDismiss = useOverlayBackDismiss(open, () => onOpenChange?.(false))

    return (
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange?.(true)
          else requestDismiss()
        }}
        {...props}
      />
    )
  },
  'ControlledDialog',
)

/**
 * The shared dialog root, with the platform back gesture wired in for every
 * call site at once — see the overlay-history module in widget-runtime.
 *
 * An uncontrolled dialog keeps Radix's own open state, which this wrapper
 * cannot drive, so it passes straight through. There is no such call site in
 * production (only `primitives.test.tsx`), but the branch must exist: without
 * it an uncontrolled dialog's close request would route into an
 * `onOpenChange` nobody is listening to and the dialog would never shut.
 */
const Dialog = reatomMemo<DialogRootProps>(({ open, ...props }) => {
  if (open === undefined) return <DialogPrimitive.Root {...props} />
  return <ControlledDialog open={open} {...props} />
}, 'Dialog')

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
