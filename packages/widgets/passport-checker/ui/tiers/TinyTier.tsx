import { wrap } from '@reatom/core'
import { CircleAlert, CircleCheck, IdCard, TriangleAlert } from 'lucide-react'
import { cn, reatomMemo } from 'widget-sdk'

import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export const TinyTier = reatomMemo(() => {
  const { checkModel } = usePassportChecker()
  const view = checkModel.viewState()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  const openRecovery = wrap(() => checkModel.recoveryOpen.set(true))

  if (view.kind === 'sessionRequired') {
    return (
      <div className={cn(styles.tiny, styles.tinyWarning)}>
        <span className={cn(styles.tinyChip, styles.tinyChipWarning)} aria-hidden>
          <TriangleAlert size={18} />
        </span>
        <span className={styles.tinyLabel}>Требуется вход в браузер</span>
        <button type="button" className={styles.tinyButton} onClick={openRecovery}>
          Открыть
        </button>
      </div>
    )
  }
  if (view.kind === 'invalidConfig') {
    return (
      <div className={styles.tiny}>
        <span className={cn(styles.tinyChip, styles.tinyChipMuted)} aria-hidden>
          <IdCard size={20} />
        </span>
        <span className={styles.tinyLabel}>Не настроен</span>
      </div>
    )
  }
  if (view.kind === 'pending') {
    return (
      <div className={styles.tiny} role="status">
        <span className={cn(styles.spinner, styles.spinnerLarge)} aria-hidden />
        <span className={styles.tinyMono}>Проверяем…</span>
        <button type="button" className={styles.tinyButton} disabled>
          Проверить
        </button>
      </div>
    )
  }
  if (view.kind === 'success') {
    return (
      <div className={styles.tiny}>
        <CircleCheck className={styles.tinySuccessIcon} size={40} aria-hidden />
        <span className={styles.tinyLabel}>{view.message}</span>
        <span className={styles.tinyStatusChip}>СТАТУС {view.status}</span>
      </div>
    )
  }
  if (view.kind === 'retryable') {
    return (
      <div className={styles.tiny}>
        <CircleAlert className={styles.tinyErrorIcon} size={40} aria-hidden />
        <span className={styles.tinyMono}>ошибка</span>
        <button type="button" className={styles.tinyButton} onClick={check}>
          Повторить
        </button>
      </div>
    )
  }
  return (
    <div className={styles.tiny}>
      <span className={styles.tinyChip} aria-hidden>
        <IdCard size={20} />
      </span>
      <span className={styles.tinyTitle}>Паспорт</span>
      <button type="button" className={styles.tinyButton} onClick={check}>
        Проверить
      </button>
    </div>
  )
}, 'PassportCheckerTinyTier')
