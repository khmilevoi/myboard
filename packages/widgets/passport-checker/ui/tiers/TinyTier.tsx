import { wrap } from '@reatom/core'
import { Check, CircleAlert, IdCard, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, reatomMemo } from 'widget-sdk'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

// oxlint-disable-next-line no-restricted-imports -- ui/tiers is nested two levels below the package's model/; the brief specifies this view type.
import type { DocumentView } from '../../model/check-model'
import { getResultsActionLabel } from '../parts/StatusBanner'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type TinyTierProps = {
  onOpenRecovery: () => void
  onDelete?: () => void
  onClose?: () => void
}

const TinyDocumentRow = reatomMemo<{ label: string; view: DocumentView }>(({ label, view }) => {
  const outcome =
    view.kind === 'success'
      ? String(view.status)
      : view.kind === 'retryable'
        ? 'ошибка'
        : 'не проверен'
  const modifier =
    view.kind === 'success'
      ? styles.tinyResultSuccess
      : view.kind === 'retryable'
        ? styles.tinyResultError
        : styles.tinyResultUnchecked

  return (
    <div
      className={cn(styles.tinyResultRow, modifier)}
      role={view.kind === 'retryable' ? 'alert' : 'status'}
    >
      <span className={styles.tinyResultLabel}>{label}</span>
      <span className={styles.tinyResultOutcome}>{outcome}</span>
    </div>
  )
}, 'PassportCheckerTinyDocumentRow')

export const TinyTier = reatomMemo(({ onOpenRecovery, onDelete, onClose }: TinyTierProps) => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  // Wrapped here, not in PassportChecker: this component re-renders on its
  // own viewState() changes independently of the parent, so the closure must
  // be bound to THIS render's frame or it goes stale (see PassportChecker.tsx).
  const openRecovery = wrap(onOpenRecovery)

  // Every state shares one shell, so the widget chrome is mounted once rather
  // than repeated in each branch. Only the modifier class, the ARIA role and
  // the body differ.
  let modifier: string | undefined
  let role: string | undefined
  let body: ReactNode

  switch (view.kind) {
    case 'sessionRequired':
      modifier = styles.tinyWarning
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={cn(styles.tinyChip, styles.tinyChipWarning)} aria-hidden>
              <TriangleAlert size={19} />
            </span>
            <span className={cn(styles.tinyLabel, styles.tinyLabelWarning)}>
              Требуется вход в браузер
            </span>
          </div>
          <button type="button" className={styles.tinyButton} onClick={openRecovery}>
            Открыть
          </button>
        </>
      )
      break

    case 'invalidConfig':
      modifier = styles.tinyCentered
      body = (
        <>
          <span className={cn(styles.tinyChip, styles.tinyChipMuted)} aria-hidden>
            <IdCard size={20} />
          </span>
          <span className={styles.tinyMutedLabel}>Не настроен</span>
        </>
      )
      break

    case 'pending':
      role = 'status'
      body = (
        <>
          <div className={cn(styles.tinyBody, styles.tinyBodyPending)}>
            <span className={cn(styles.spinner, styles.spinnerLarge)} aria-hidden />
            <span className={styles.tinyMono}>Проверяем…</span>
          </div>
          <button type="button" className={styles.tinyButton} disabled>
            Проверить
          </button>
        </>
      )
      break

    case 'results': {
      const label = getResultsActionLabel(view)
      const isInitialCheck = label === 'Проверить'
      body = (
        <>
          <span className={styles.tinyTitle}>Паспорт</span>
          <ul className={styles.tinyResultsList} role="list">
            <li>
              <TinyDocumentRow label="ID" view={view.idCard} />
            </li>
            <li>
              <TinyDocumentRow label="Загран" view={view.internationalPassport} />
            </li>
          </ul>
          <button
            type="button"
            className={isInitialCheck ? styles.tinyButton : styles.tinySecondaryButton}
            onClick={check}
          >
            {isInitialCheck ? (
              <Check size={13} strokeWidth={2.2} aria-hidden />
            ) : (
              <RefreshCw size={13} aria-hidden />
            )}
            {label}
          </button>
        </>
      )
      break
    }

    case 'retryable':
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={cn(styles.tinyBadge, styles.tinyBadgeError)} aria-hidden>
              <CircleAlert size={21} />
            </span>
            <span className={cn(styles.tinyMono, styles.tinyMonoError)}>ошибка</span>
          </div>
          <button type="button" className={styles.tinySecondaryButton} onClick={check}>
            <RefreshCw size={13} aria-hidden /> Повторить
          </button>
        </>
      )
      break

    case 'idle':
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={styles.tinyChip} aria-hidden>
              <IdCard size={21} />
            </span>
            <span className={styles.tinyTitle}>Паспорт</span>
          </div>
          <button type="button" className={styles.tinyButton} onClick={check}>
            Проверить
          </button>
        </>
      )
      break

    default:
      // `ReactNode` already includes `undefined`, so a missing case here
      // would NOT trip TypeScript's used-before-assignment check on `body` —
      // this is the guard that actually makes a missing case a compile error.
      view satisfies never
      break
  }

  return (
    <div className={cn(styles.tiny, modifier)} role={role}>
      <WidgetControls onDelete={onDelete} onClose={onClose} />
      {body}
    </div>
  )
}, 'PassportCheckerTinyTier')
