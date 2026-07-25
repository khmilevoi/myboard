import { wrap } from '@reatom/core'
import { Check, CircleAlert, IdCard, RefreshCw, TriangleAlert } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type TinyTierProps = { onOpenRecovery: () => void }

export const TinyTier = reatomMemo(({ onOpenRecovery }: TinyTierProps) => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  // Wrapped here, not in PassportChecker: this component re-renders on its
  // own viewState() changes independently of the parent, so the closure must
  // be bound to THIS render's frame or it goes stale (see PassportChecker.tsx).
  const openRecovery = wrap(onOpenRecovery)

  if (view.kind === 'sessionRequired') {
    return (
      <div className={cn(styles.tiny, styles.tinyWarning)}>
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
      </div>
    )
  }
  if (view.kind === 'invalidConfig') {
    return (
      <div className={cn(styles.tiny, styles.tinyCentered)}>
        <span className={cn(styles.tinyChip, styles.tinyChipMuted)} aria-hidden>
          <IdCard size={20} />
        </span>
        <span className={styles.tinyMutedLabel}>Не настроен</span>
      </div>
    )
  }
  if (view.kind === 'pending') {
    return (
      <div className={styles.tiny} role="status">
        <div className={cn(styles.tinyBody, styles.tinyBodyPending)}>
          <span className={cn(styles.spinner, styles.spinnerLarge)} aria-hidden />
          <span className={styles.tinyMono}>Проверяем…</span>
        </div>
        <button type="button" className={styles.tinyButton} disabled>
          Проверить
        </button>
      </div>
    )
  }
  if (view.kind === 'success') {
    return (
      <div className={styles.tiny}>
        <div className={styles.tinyBody}>
          <span className={cn(styles.tinyBadge, styles.tinyBadgeSuccess)} aria-hidden>
            <Check size={21} strokeWidth={2.6} />
          </span>
          <span className={cn(styles.tinyLabel, styles.tinyLabelSuccess)}>{view.message}</span>
        </div>
        <span className={styles.tinyStatusChip}>СТАТУС {view.status}</span>
      </div>
    )
  }
  if (view.kind === 'retryable') {
    return (
      <div className={styles.tiny}>
        <div className={styles.tinyBody}>
          <span className={cn(styles.tinyBadge, styles.tinyBadgeError)} aria-hidden>
            <CircleAlert size={21} />
          </span>
          <span className={cn(styles.tinyMono, styles.tinyMonoError)}>ошибка</span>
        </div>
        <button type="button" className={styles.tinySecondaryButton} onClick={check}>
          <RefreshCw size={13} aria-hidden /> Повторить
        </button>
      </div>
    )
  }
  return (
    <div className={styles.tiny}>
      <div className={styles.tinyBody}>
        <span className={styles.tinyChip} aria-hidden>
          <IdCard size={21} />
        </span>
        <span className={styles.tinyTitle}>Паспорт</span>
      </div>
      <button type="button" className={styles.tinyButton} onClick={check}>
        Проверить
      </button>
    </div>
  )
}, 'PassportCheckerTinyTier')
