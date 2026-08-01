import { wrap } from '@reatom/core'
import {
  BookOpen,
  Check,
  CircleAlert,
  IdCard,
  RefreshCw,
  Settings,
  TriangleAlert,
} from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn, reatomMemo } from 'widget-sdk'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

// oxlint-disable-next-line no-restricted-imports -- ui/tiers is nested two levels below the package's model/; the brief specifies this view type.
import { getDocumentCheckedAt } from '../../model/check-model'
// oxlint-disable-next-line no-restricted-imports -- ui/tiers is nested two levels below the package's model/; the brief specifies this view type.
import type { DocumentView, ResultsViewState } from '../../model/check-model'
import { getResultsActionLabel } from '../parts/StatusBanner'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type TinyTierProps = {
  onOpenRecovery: () => void
  onExpand?: () => void
  onDelete?: () => void
  onClose?: () => void
}

type TinyResultsSummary = {
  label: string
  meta?: string
  tone: 'success' | 'warning' | 'error'
}

function latestSuccessfulDocument(
  view: ResultsViewState,
): Extract<DocumentView, { kind: 'success' }> | null {
  const successes = [view.idCard, view.internationalPassport].filter(
    (document): document is Extract<DocumentView, { kind: 'success' }> =>
      document.kind === 'success',
  )
  if (successes.length === 0) return null

  return successes.reduce((latest, document) =>
    (getDocumentCheckedAt(document) ?? Number.NEGATIVE_INFINITY) >
    (getDocumentCheckedAt(latest) ?? Number.NEGATIVE_INFINITY)
      ? document
      : latest,
  )
}

export function getTinyResultsSummary(view: ResultsViewState): TinyResultsSummary {
  const successfulDocument = latestSuccessfulDocument(view)
  const successfulCount = [view.idCard, view.internationalPassport].filter(
    (document) => document.kind === 'success',
  ).length

  return {
    label:
      successfulCount === 2
        ? 'Данные обновлены'
        : successfulCount === 1
          ? 'Обновлено частично'
          : 'Данные не обновлены',
    meta:
      successfulCount === 2 && successfulDocument
        ? `обновлено ${successfulDocument.checkedAtLabel}`
        : successfulCount === 1 && successfulDocument
          ? `1 из 2 · ${successfulDocument.checkedAtLabel}`
          : undefined,
    tone: successfulCount === 2 ? 'success' : successfulCount === 1 ? 'warning' : 'error',
  }
}

/** The lone exclamation mark lucide draws inside CircleAlert, without
 *  CircleAlert's own ring — the badge circle behind it already plays that role. */
function ExclamationGlyph() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3.4}>
      <path d="M12 8v3.5" strokeLinecap="round" />
      <path d="M12 16h.01" strokeLinecap="round" />
    </svg>
  )
}

type ChipTone = 'neutral' | 'success' | 'errorBadge' | 'errorFlat'

/**
 * A retryable document only earns the flat, badge-less red once nothing on
 * the tile succeeded (resultsTone === 'error'); otherwise it sits beside a
 * success chip and the badge is what makes "1 of 2 failed" legible without
 * opening the widget.
 */
function documentChipTone(
  document: DocumentView,
  resultsTone: TinyResultsSummary['tone'],
): ChipTone {
  if (document.kind === 'success') return 'success'
  if (document.kind === 'unchecked') return 'neutral'
  return resultsTone === 'warning' ? 'errorBadge' : 'errorFlat'
}

function DocumentChip({
  icon: Icon,
  tone,
}: {
  icon: ComponentType<{ size?: number }>
  tone: ChipTone
}) {
  return (
    <span
      className={cn(
        styles.tinyIconChip,
        tone === 'errorBadge' || tone === 'errorFlat'
          ? styles.tinyIconChipError
          : styles.tinyIconChipNeutral,
      )}
    >
      <Icon size={14} />
      {tone === 'success' && (
        <span className={cn(styles.tinyIconBadge, styles.tinyIconBadgeSuccess)}>
          <Check size={7} strokeWidth={3.6} />
        </span>
      )}
      {tone === 'errorBadge' && (
        <span className={cn(styles.tinyIconBadge, styles.tinyIconBadgeError)}>
          <ExclamationGlyph />
        </span>
      )}
    </span>
  )
}

export const TinyTier = reatomMemo(
  ({ onOpenRecovery, onExpand, onDelete, onClose }: TinyTierProps) => {
    const { checkModel } = usePassportChecker()
    const view = checkModel.viewState()
    const check = wrap(() => {
      void checkModel.checkPassport()
    })
    // Wrapped here, not in PassportChecker: this component re-renders on its
    // own viewState() changes independently of the parent, so the closure must
    // be bound to THIS render's frame or it goes stale (see PassportChecker.tsx).
    const openRecovery = wrap(onOpenRecovery)

    let icons: ReactNode
    let labelTone = styles.tinyLabelDefault
    let label = ''
    let meta: string | undefined
    let role: 'alert' | 'status' = 'status'
    let action: ReactNode
    let warning = false

    switch (view.kind) {
      case 'sessionRequired':
        warning = true
        icons = (
          <span className={styles.tinyBigIcon}>
            <TriangleAlert size={18} />
          </span>
        )
        label = 'Войдите в браузер'
        action = (
          <button type="button" className={styles.tinyButton} onClick={openRecovery}>
            Открыть
          </button>
        )
        break

      case 'invalidConfig':
        icons = (
          <span className={cn(styles.tinyBigIcon, styles.tinyBigIconMuted)}>
            <Settings size={19} />
          </span>
        )
        labelTone = styles.tinyLabelMuted
        label = 'Не настроен'
        action = null
        break

      case 'pending':
        icons = <span className={styles.spinnerLarge} />
        labelTone = styles.tinyLabelMuted
        label = 'Обновляем данные…'
        action = (
          <button type="button" className={styles.tinyButton} disabled>
            Проверить
          </button>
        )
        break

      case 'results': {
        const summary = getTinyResultsSummary(view)
        label = summary.label
        meta = summary.meta
        labelTone =
          summary.tone === 'success'
            ? styles.tinyLabelSuccess
            : summary.tone === 'warning'
              ? styles.tinyLabelWarning
              : styles.tinyLabelError
        role = summary.tone === 'error' ? 'alert' : 'status'
        icons = (
          <span className={styles.tinyIcons}>
            <DocumentChip icon={IdCard} tone={documentChipTone(view.idCard, summary.tone)} />
            <DocumentChip
              icon={BookOpen}
              tone={documentChipTone(view.internationalPassport, summary.tone)}
            />
          </span>
        )
        action = (
          <button type="button" className={styles.tinySecondaryButton} onClick={check}>
            <RefreshCw size={13} /> {getResultsActionLabel(view)}
          </button>
        )
        break
      }

      case 'retryable':
        icons = (
          <span className={cn(styles.tinyBigIcon, styles.tinyBigIconError)}>
            <CircleAlert size={21} />
          </span>
        )
        labelTone = styles.tinyLabelError
        label = 'Не удалось обновить'
        meta = 'Попробуйте ещё раз'
        role = 'alert'
        action = (
          <button type="button" className={styles.tinySecondaryButton} onClick={check}>
            <RefreshCw size={13} /> Повторить
          </button>
        )
        break

      case 'idle':
        icons = (
          <span className={styles.tinyIcons}>
            <DocumentChip icon={IdCard} tone="neutral" />
            <DocumentChip icon={BookOpen} tone="neutral" />
          </span>
        )
        label = 'Паспорт'
        meta = 'Нет данных'
        action = (
          <button type="button" className={styles.tinyButton} onClick={check}>
            Проверить
          </button>
        )
        break

      default:
        view satisfies never
        break
    }

    return (
      <div className={cn(styles.tiny, warning && styles.tinyWarning)}>
        <WidgetControls
          placement="overlay"
          onExpand={onExpand}
          onDelete={onDelete}
          onClose={onClose}
        />
        <div className={styles.tinyBody} role={role}>
          {icons}
          <span className={cn(styles.tinyLabel, labelTone)} title={label}>
            {label}
          </span>
          {meta && <span className={styles.tinyMeta}>{meta}</span>}
        </div>
        {action}
      </div>
    )
  },
  'PassportCheckerTinyTier',
)
