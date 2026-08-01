import { wrap } from '@reatom/core'
import { AppWindow, Check, CircleAlert, IdCard, RefreshCw } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import { getResultsActionLabel, GlobalStatusBanner, StatusBanner } from '../parts/StatusBanner'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type StandardTierProps = {
  onOpenRecovery: () => void
  onDelete?: () => void
  onClose?: () => void
}

export const StandardTier = reatomMemo(
  ({ onOpenRecovery, onDelete, onClose }: StandardTierProps) => {
    const { checkModel } = usePassportChecker()
    const view = checkModel.viewState()
    const check = wrap(() => {
      void checkModel.checkPassport()
    })
    // Wrapped here, not in PassportChecker: this component re-renders on its
    // own viewState() changes independently of the parent, so the closure must
    // be bound to THIS render's frame or it goes stale (see PassportChecker.tsx).
    const openRecovery = wrap(onOpenRecovery)
    const resultsActionLabel = view.kind === 'results' ? getResultsActionLabel(view) : null

    return (
      <div className={styles.standard}>
        <WidgetControls onDelete={onDelete} onClose={onClose} />
        <header className={styles.header}>
          <span
            className={cn(styles.iconChip, view.kind === 'invalidConfig' && styles.iconChipMuted)}
            aria-hidden
          >
            <IdCard size={16} />
          </span>
          <span className={styles.headerText}>
            <span className={styles.title}>Паспорт</span>
            <span className={styles.subtitle}>Проверка ID-карты и загранпаспорта</span>
          </span>
        </header>

        {/* One flexible row, so every state lands its action on the same baseline:
          the idle copy hugs the header, everything else centres in the gap. */}
        <div className={cn(styles.body, view.kind === 'idle' && styles.bodyTop)}>
          {view.kind === 'idle' && <p className={styles.description}>Проверка статуса паспорта</p>}
          {view.kind === 'pending' && (
            <div className={styles.pendingRow} role="status">
              <span className={styles.spinner} aria-hidden />
              Проверяем…
            </div>
          )}
          {view.kind === 'results' && (
            <ul className={styles.resultsList} role="list">
              <li>
                <StatusBanner label="ID-карта" view={view.idCard} />
              </li>
              <li>
                <StatusBanner label="Загранпаспорт" view={view.internationalPassport} />
              </li>
            </ul>
          )}
          <GlobalStatusBanner view={view} />
        </div>

        {(view.kind === 'idle' || view.kind === 'pending') && (
          <button
            type="button"
            className={styles.primaryButton}
            disabled={view.kind === 'pending'}
            onClick={check}
          >
            <Check size={15} strokeWidth={2.2} aria-hidden /> Проверить
          </button>
        )}
        {view.kind === 'results' && resultsActionLabel !== null && (
          <button
            type="button"
            className={
              resultsActionLabel === 'Проверить' ? styles.primaryButton : styles.secondaryButton
            }
            onClick={check}
          >
            {resultsActionLabel === 'Проверить' ? (
              <Check size={15} strokeWidth={2.2} aria-hidden />
            ) : (
              <RefreshCw size={14} aria-hidden />
            )}
            {resultsActionLabel}
          </button>
        )}
        {view.kind === 'retryable' && (
          <button type="button" className={styles.secondaryButton} onClick={check}>
            <RefreshCw size={14} aria-hidden /> Повторить
          </button>
        )}
        {view.kind === 'sessionRequired' && (
          <button type="button" className={styles.primaryButton} onClick={openRecovery}>
            <AppWindow size={15} aria-hidden /> Открыть восстановление
          </button>
        )}
        {view.kind === 'invalidConfig' && (
          <div className={styles.footerNote}>
            <CircleAlert className={styles.footerNoteIcon} size={13} aria-hidden />
            действие недоступно · нужна настройка на сервере
          </div>
        )}
      </div>
    )
  },
  'PassportCheckerStandardTier',
)
