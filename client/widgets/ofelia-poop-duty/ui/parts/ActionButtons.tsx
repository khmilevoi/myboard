import { reatomMemo } from '@/shared/reatom/reatom-memo'

import { IconButtons } from './IconButtons'
import { LabeledButtons } from './LabeledButtons'

export type ActionButtonsProps = {
  status: 'pending' | 'closed'
  canUndo: boolean
  canForgive: boolean
  className?: string
  compact?: boolean
  inactive?: boolean
  primaryLabel?: string
  debtLabel?: string
  forgiveLabel?: string
  showNotes?: boolean
  onConfirm: () => void
  onUndo: () => void
  onDebt: () => void
  onForgive: () => void
}

export const ActionButtons = reatomMemo<ActionButtonsProps>(({ className, compact, ...rest }) => {
  if (compact) {
    return (
      <IconButtons
        className={className}
        status={rest.status}
        canUndo={rest.canUndo}
        canForgive={rest.canForgive}
        inactive={rest.inactive}
        onConfirm={rest.onConfirm}
        onUndo={rest.onUndo}
        onDebt={rest.onDebt}
        onForgive={rest.onForgive}
      />
    )
  }

  return (
    <LabeledButtons
      className={className}
      status={rest.status}
      canUndo={rest.canUndo}
      canForgive={rest.canForgive}
      inactive={rest.inactive}
      primaryLabel={rest.primaryLabel}
      debtLabel={rest.debtLabel}
      forgiveLabel={rest.forgiveLabel}
      showNotes={rest.showNotes}
      onConfirm={rest.onConfirm}
      onUndo={rest.onUndo}
      onDebt={rest.onDebt}
      onForgive={rest.onForgive}
    />
  )
}, 'ActionButtons')
