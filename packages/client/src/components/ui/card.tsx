import * as React from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

const Card = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="card"
      className={cn(
        'flex flex-col gap-6 rounded-xl border border-border bg-card py-6 text-card-foreground shadow-xs',
        className,
      )}
      {...props}
    />
  )
}, 'Card')

const CardHeader = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="card-header"
      className={cn('flex flex-col gap-1.5 px-6', className)}
      {...props}
    />
  )
}, 'CardHeader')

const CardTitle = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="card-title"
      className={cn('font-semibold leading-none', className)}
      {...props}
    />
  )
}, 'CardTitle')

const CardDescription = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="card-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}, 'CardDescription')

const CardContent = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return <div data-slot="card-content" className={cn('px-6', className)} {...props} />
}, 'CardContent')

const CardFooter = reatomMemo<React.ComponentProps<'div'>>(({ className, ...props }) => {
  return (
    <div
      data-slot="card-footer"
      className={cn('flex items-center px-6', className)}
      {...props}
    />
  )
}, 'CardFooter')

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter }
