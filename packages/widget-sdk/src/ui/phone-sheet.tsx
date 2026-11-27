import type { ReactNode } from 'react'

import { cn } from '../lib/utils'
import { reatomMemo } from '../reatom/reatom-memo'

import styles from './phone-sheet.module.css'

/** The frame class, so a Radix `DialogContent` can be the sheet itself. */
export const phoneSheetContentClassName: string = styles.frame

export type PhoneSheetProps = {
  className?: string
  children: ReactNode
}

export type PhoneSheetPartProps = {
  children: ReactNode
}

/**
 * A flex-column dialog frame that goes full-screen on phones
 * (`max-width: 640px`). Compose it from header, body and footer.
 */
export const PhoneSheet = reatomMemo<PhoneSheetProps>(
  ({ className, children }) => (
    <div className={cn(phoneSheetContentClassName, className)} data-slot="phone-sheet">
      {children}
    </div>
  ),
  'PhoneSheet',
)

export const PhoneSheetHeader = reatomMemo<PhoneSheetPartProps>(
  ({ children }) => (
    <div className={styles.header} data-slot="phone-sheet-header">
      {children}
    </div>
  ),
  'PhoneSheetHeader',
)

export const PhoneSheetBody = reatomMemo<PhoneSheetPartProps>(
  ({ children }) => (
    <div className={styles.body} data-slot="phone-sheet-body">
      {children}
    </div>
  ),
  'PhoneSheetBody',
)

export const PhoneSheetFooter = reatomMemo<PhoneSheetPartProps>(
  ({ children }) => (
    <div className={styles.footer} data-slot="phone-sheet-footer">
      {children}
    </div>
  ),
  'PhoneSheetFooter',
)
