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
import type { ReactNode } from 'react'
import { cn, reatomMemo } from 'widget-sdk'
import { WidgetControls } from 'widget-sdk/ui/WidgetControls'

import { NoVncCanvas } from '../parts/NoVncCanvas'
import { SshFallback } from '../parts/SshFallback'
import { getResultsActionLabel, StatusBanner } from '../parts/StatusBanner'
import { usePassportChecker } from '../passport-checker-context'
import { formatAccessCountdown } from '../RecoveryModal'

import styles from '../fullscreen-tier.module.css'

export type FullscreenTierProps = {
  onOpenRecovery: () => void
  onClose?: () => void
}

function DocumentIcons({ size = 24 }: { size?: number }) {
  return (
    <span className={styles.fsIcons}>
      <span className={styles.fsHeroIconChip}>
        <IdCard size={size} />
      </span>
      <span className={styles.fsHeroIconChip}>
        <BookOpen size={size} />
      </span>
    </span>
  )
}

export const FullscreenTier = reatomMemo(({ onOpenRecovery, onClose }: FullscreenTierProps) => {
  const { checkModel, recoveryModel, recoveryFlow } = usePassportChecker()
  const view = checkModel.viewState()
  const recoverySurface = checkModel.recoverySurface()
  const check = wrap(() => {
    void checkModel.checkPassport()
  })
  // Wrapped here, not in PassportChecker: this component re-renders on its
  // own viewState()/recoverySurface() changes independently of the parent,
  // so the closures must be bound to THIS render's frame or they go stale
  // (see PassportChecker.tsx).
  const openRecovery = wrap(onOpenRecovery)
  const closeRecovery = wrap(() => recoveryFlow.closeRecovery())
  const retryRecovery = wrap(() => recoveryFlow.retryCheck())

  let headerPill: ReactNode = null
  let body: ReactNode
  let footer: ReactNode = null

  switch (view.kind) {
    case 'idle':
      body = (
        <div className={styles.fsHero}>
          <DocumentIcons size={24} />
          <div className={styles.fsHeroTitle}>Нет данных о статусе</div>
          <p className={styles.fsHeroText}>
            Проверьте статус ID-карты и загранпаспорта через автоматизированный вход в портал
            ведомства. Это может занять до 90 секунд.
          </p>
          <button type="button" className={styles.fsPrimaryButton} onClick={check}>
            <Check size={16} strokeWidth={2.2} /> Проверить
          </button>
        </div>
      )
      break

    case 'pending':
      body = (
        <div className={styles.fsHero}>
          <span className={styles.fsSpinner} />
          <div className={styles.fsHeroTitle}>Обновляем данные</div>
          <p className={styles.fsHeroText}>
            Входим в портал и опрашиваем статус по обоим документам. Обычно занимает до 90 секунд —
            можно закрыть окно, проверка продолжится в фоне.
          </p>
          <div className={styles.fsPendingRow}>
            <span className={styles.fsPendingChip}>
              <span className={styles.fsPulseDot} /> ID-карта
            </span>
            <span className={styles.fsPendingChip}>
              <span className={styles.fsPulseDot} /> Загранпаспорт
            </span>
          </div>
        </div>
      )
      break

    case 'results': {
      const successCount = [view.idCard, view.internationalPassport].filter(
        (document) => document.kind === 'success',
      ).length
      if (successCount > 0) {
        const checkedAtLabel =
          (view.idCard.kind === 'success' && view.idCard.checkedAtLabel) ||
          (view.internationalPassport.kind === 'success' &&
            view.internationalPassport.checkedAtLabel)
        headerPill = (
          <span
            className={cn(
              styles.fsPill,
              successCount === 2 ? styles.fsPillSuccess : styles.fsPillMuted,
            )}
          >
            {successCount === 2
              ? `Обновлено ${checkedAtLabel}`
              : `Обновлено частично · ${successCount} из 2`}
          </span>
        )
      }
      const label = getResultsActionLabel(view)
      body = (
        <div className={styles.fsResults}>
          <div className={styles.fsDocumentGrid}>
            <StatusBanner label="ID-карта" view={view.idCard} />
            <StatusBanner label="Загранпаспорт" view={view.internationalPassport} />
          </div>
          <div className={styles.fsPanel}>
            <div className={styles.fsPanelHeading}>Что проверяется и зачем</div>
            <p className={styles.fsPanelText}>
              Виджет заходит на портал ведомства под вашей учётной записью и сверяет два документа:
              срок действия <b>ID-карты</b> и наличие ограничений на выезд по <b>загранпаспорту</b>.
              Полезно перед поездкой или продлением — не нужно заходить на портал вручную.
            </p>
          </div>
        </div>
      )
      footer = (
        <button
          type="button"
          className={label === 'Проверить' ? styles.fsPrimaryButton : styles.fsSecondaryButton}
          onClick={check}
        >
          {label === 'Проверить' ? <Check size={15} strokeWidth={2.2} /> : <RefreshCw size={14} />}
          {label}
        </button>
      )
      break
    }

    case 'retryable':
      body = (
        <div className={styles.fsHero}>
          <span className={cn(styles.fsHeroIcon, styles.fsHeroIconError)}>
            <CircleAlert size={26} />
          </span>
          <div className={styles.fsHeroTitle}>{view.message}</div>
          <p className={styles.fsHeroText}>Проверка не запустилась. Попробуйте ещё раз.</p>
          <button type="button" className={styles.fsSecondaryButton} onClick={check}>
            <RefreshCw size={14} /> Повторить
          </button>
        </div>
      )
      break

    case 'invalidConfig':
      body = (
        <div className={styles.fsHero}>
          <span className={cn(styles.fsHeroIcon, styles.fsHeroIconMuted)}>
            <Settings size={24} />
          </span>
          <div className={styles.fsHeroTitle}>Паспорт-чекер не настроен на сервере</div>
          <p className={styles.fsHeroText}>
            Виджет установлен, но администратор ещё не задал параметры доступа к порталу. Действия
            недоступны, пока конфигурация не завершена.
          </p>
        </div>
      )
      break

    case 'sessionRequired':
      if (recoverySurface === 'inline') {
        const recoveryState = recoveryModel.state()
        const remaining = recoveryModel.remainingMs()
        const total =
          recoveryState.kind === 'connecting' || recoveryState.kind === 'connected'
            ? recoveryState.expiresInMs
            : null
        headerPill = (
          <span className={cn(styles.fsPill, styles.fsPillWarning)}>
            <span className={styles.fsPulseDot} /> доступ · {formatAccessCountdown(remaining)}
          </span>
        )
        body = (
          <div className={styles.fsRecovery}>
            <div className={styles.fsRecoveryBanner}>
              <TriangleAlert size={16} />
              <span>
                Автоматике потребовался ручной шаг на портале ведомства (например, капча или
                повторный вход). Пройдите его в окне ниже — проверка возобновится сама, как только
                шаг будет пройден.
              </span>
            </div>
            <div className={styles.fsRecoveryBody}>
              <div className={styles.fsRecoveryCanvas}>
                <NoVncCanvas />
                <SshFallback sshTarget={view.sshTarget} novncPort={view.novncPort} />
              </div>
              <div className={styles.fsRecoverySide}>
                <div className={styles.fsPanel}>
                  <div className={styles.fsPanelHeading}>Что сейчас происходит</div>
                  <p className={styles.fsPanelText}>
                    Портал попросил подтвердить ручной шаг. Кликните в окне слева и пройдите его так
                    же, как в обычном браузере — курсор и клавиатура передаются напрямую в удалённую
                    сессию.
                  </p>
                </div>
                {total !== null && (
                  <div className={styles.fsPanel}>
                    <div className={styles.fsCountdownRow}>
                      <span className={styles.fsPanelHeading}>Доступ истекает через</span>
                      <span className={styles.fsCountdownValue}>
                        {formatAccessCountdown(remaining)}
                      </span>
                    </div>
                    <div className={styles.fsCountdownTrack}>
                      <div
                        className={styles.fsCountdownFill}
                        style={{ width: `${Math.min(100, (remaining / total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
        footer = (
          <>
            <button type="button" className={styles.fsSecondaryButton} onClick={closeRecovery}>
              Закрыть
            </button>
            <button type="button" className={styles.fsPrimaryButton} onClick={retryRecovery}>
              <Check size={15} strokeWidth={2.2} /> Повторить проверку
            </button>
          </>
        )
      } else {
        body = (
          <div className={styles.fsHero}>
            <span className={cn(styles.fsHeroIcon, styles.fsHeroIconWarning)}>
              <TriangleAlert size={24} />
            </span>
            <div className={styles.fsHeroTitle}>Требуется вход в браузер</div>
            <p className={styles.fsHeroText}>
              Автоматике потребовался ручной шаг в браузере — например, капча или повторный вход.
              Откройте живое окно ниже и пройдите его вручную.
            </p>
            <button type="button" className={styles.fsPrimaryButton} onClick={openRecovery}>
              Открыть восстановление
            </button>
          </div>
        )
      }
      break

    default:
      view satisfies never
      body = null
  }

  return (
    <div className={styles.fs}>
      <header className={styles.fsHeader}>
        <span className={styles.fsIconChip}>
          <IdCard size={20} />
        </span>
        <span className={styles.fsHeaderText}>
          <span className={styles.fsTitle}>Паспорт</span>
          <span className={styles.fsSubtitle}>Проверка ID-карты и загранпаспорта</span>
        </span>
        {headerPill}
        <WidgetControls placement="inline" onClose={onClose} />
      </header>
      <div className={styles.fsBody}>{body}</div>
      {footer && <footer className={styles.fsFooter}>{footer}</footer>}
    </div>
  )
}, 'PassportCheckerFullscreenTier')
