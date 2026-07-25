import { wrap } from '@reatom/core'
import { AppWindow, Check, CircleAlert, IdCard, RefreshCw } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import { StatusBanner } from '../parts/StatusBanner'
import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type StandardTierProps = { onOpenRecovery: () => void }

export const StandardTier = reatomMemo(({ onOpenRecovery }: StandardTierProps) => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  // Wrapped here, not in PassportChecker: this component re-renders on its
  // own viewState() changes independently of the parent, so the closure must
  // be bound to THIS render's frame or it goes stale (see PassportChecker.tsx).
  const openRecovery = wrap(onOpenRecovery)

  return (
    <div className={styles.standard}>
      <header className={styles.header}>
        <span
          className={cn(styles.iconChip, view.kind === 'invalidConfig' && styles.iconChipMuted)}
          aria-hidden
        >
          <IdCard size={16} />
        </span>
        <span className={styles.title}>Паспорт</span>
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
        <StatusBanner view={view} />
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
      {view.kind === 'success' && (
        <button type="button" className={styles.secondaryButton} onClick={check}>
          <RefreshCw size={14} aria-hidden /> Проверить снова
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
}, 'PassportCheckerStandardTier')
