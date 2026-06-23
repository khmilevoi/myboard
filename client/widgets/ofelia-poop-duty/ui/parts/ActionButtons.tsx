import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { IconButtons } from './IconButtons'
import type { IconButtonsProps } from './IconButtons'
import { LabeledButtons } from './LabeledButtons'
import type { LabeledButtonsProps } from './LabeledButtons'

export type ActionButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  compact?: boolean
  inactive?: boolean
  primaryLabel?: string
  showNotes?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const ActionButtons = reatomMemo<ActionButtonsProps>(
  ({ compact, ...rest }) => {
    if (compact) {
      const iconProps: IconButtonsProps = {
        canForgive: rest.canForgive,
        onConfirm: rest.onConfirm,
        onDebt: rest.onDebt,
        onForgive: rest.onForgive,
      }
      return <IconButtons {...iconProps} />
    }

    const labeledProps: LabeledButtonsProps = {
      status: rest.status,
      canUndo: rest.canUndo,
      canForgive: rest.canForgive,
      inactive: rest.inactive,
      primaryLabel: rest.primaryLabel,
      showNotes: rest.showNotes,
      onConfirm: rest.onConfirm,
      onUndo: rest.onUndo,
      onDebt: rest.onDebt,
      onForgive: rest.onForgive,
    }
    return <LabeledButtons {...labeledProps} />
  },
  'ActionButtons',
)