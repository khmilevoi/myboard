import { wrap } from '@reatom/core'
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  IdCard,
  LoaderCircle,
  RefreshCw,
  TriangleAlert,
} from 'lucide-react'
import type { ReactNode } from 'react'
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
  updatedAt?: string
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
    updatedAt: successfulDocument ? `Обновлено ${successfulDocument.checkedAtLabel}` : undefined,
    tone: successfulCount === 2 ? 'success' : successfulCount === 1 ? 'warning' : 'error',
  }
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

    let statusLabel = ''
    let statusMeta: string | undefined
    let statusIcon: ReactNode = null
    let statusTone = styles.tinyStatusMuted
    let statusRole: 'alert' | 'status' = 'status'
    let action: ReactNode

    switch (view.kind) {
      case 'sessionRequired':
        statusLabel = 'Требуется вход'
        statusMeta = 'Войдите в браузер'
        statusIcon = <TriangleAlert size={15} aria-hidden />
        statusTone = styles.tinyStatusWarning
        action = (
          <button type="button" className={styles.tinyButton} onClick={openRecovery}>
            Открыть
          </button>
        )
        break

      case 'invalidConfig':
        statusLabel = 'Не настроен'
        statusMeta = 'Нужна настройка сервера'
        statusIcon = <IdCard size={15} aria-hidden />
        statusTone = styles.tinyStatusMuted
        action = null
        break

      case 'pending':
        statusLabel = 'Обновляем данные'
        statusMeta = 'Это займёт несколько секунд'
        statusIcon = <LoaderCircle className={styles.tinyStatusLoading} size={15} aria-hidden />
        statusTone = styles.tinyStatusMuted
        action = (
          <button type="button" className={styles.tinySecondaryButton} disabled>
            <RefreshCw size={13} aria-hidden /> Проверяем…
          </button>
        )
        break

      case 'results': {
        const label = getResultsActionLabel(view)
        const summary = getTinyResultsSummary(view)
        statusLabel = summary.label
        statusMeta = summary.updatedAt
        statusIcon =
          summary.tone === 'success' ? (
            <CircleCheck size={15} aria-hidden />
          ) : (
            <CircleAlert size={15} aria-hidden />
          )
        statusTone =
          summary.tone === 'success'
            ? styles.tinyStatusSuccess
            : summary.tone === 'warning'
              ? styles.tinyStatusWarning
              : styles.tinyStatusError
        statusRole = summary.tone === 'error' ? 'alert' : 'status'
        action = (
          <button type="button" className={styles.tinySecondaryButton} onClick={check}>
            <RefreshCw size={13} aria-hidden /> {label}
          </button>
        )
        break
      }

      case 'retryable':
        statusLabel = 'Не удалось обновить'
        statusMeta = 'Попробуйте ещё раз'
        statusIcon = <CircleAlert size={15} aria-hidden />
        statusTone = styles.tinyStatusError
        statusRole = 'alert'
        action = (
          <button type="button" className={styles.tinySecondaryButton} onClick={check}>
            <RefreshCw size={13} aria-hidden /> Повторить
          </button>
        )
        break

      case 'idle':
        statusLabel = 'Нет данных'
        statusMeta = 'Паспорт'
        statusIcon = <CircleDashed size={15} aria-hidden />
        statusTone = styles.tinyStatusMuted
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
      <div className={styles.tiny}>
        <div className={styles.tinyHeader}>
          <div className={cn(styles.tinyStatus, statusTone)} role={statusRole}>
            <span className={styles.tinyStatusIcon}>{statusIcon}</span>
            <span className={styles.tinyStatusLabel} title={statusLabel}>
              {statusLabel}
            </span>
          </div>
          <WidgetControls
            placement="inline"
            onExpand={onExpand}
            onDelete={onDelete}
            onClose={onClose}
          />
        </div>
        {statusMeta && <p className={styles.tinyMeta}>{statusMeta}</p>}
        {action}
      </div>
    )
  },
  'PassportCheckerTinyTier',
)
