import { wrap } from '@reatom/core'
import { Check, CircleAlert, IdCard, RefreshCw, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn, reatomMemo } from 'widget-sdk'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import { usePassportChecker } from '../passport-checker-context'

import styles from '../passport-checker.module.css'

export type TinyTierProps = {
  onOpenRecovery: () => void
  onDelete?: () => void
  onClose?: () => void
}

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

    case 'success':
      body = (
        <>
          <div className={styles.tinyBody}>
            <span className={cn(styles.tinyBadge, styles.tinyBadgeSuccess)} aria-hidden>
              <Check size={21} strokeWidth={2.6} />
            </span>
            <span className={cn(styles.tinyLabel, styles.tinyLabelSuccess)}>{view.message}</span>
          </div>
          {/* The tiny tile has no room for a second banner line, but a restored
              result can be days old, so the timestamp rides along in the same
              chip rather than being dropped (see StandardTier's bannerMeta,
              which shows the same fact at full size).

              The chip is also the action, rather than carrying one below it,
              because this state would otherwise be a dead end: the widget
              deliberately offers no expand affordance, so a card narrower than
              the 321px `standard` threshold (client.ts) that restores a stored
              result on mount would have no way left to re-check. Folding the
              action into the row the state already draws costs no height, so it
              still fits the smallest tile.

              The accessible name repeats the visible text after the action so
              the name contains the label a user can see, rather than replacing
              it. */}
          <button
            type="button"
            className={styles.tinyStatusChip}
            aria-label={`Проверить снова · СТАТУС ${view.status} · ${view.checkedAtLabel}`}
            onClick={check}
          >
            <RefreshCw size={12} aria-hidden />
            СТАТУС {view.status} · {view.checkedAtLabel}
          </button>
        </>
      )
      break

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
