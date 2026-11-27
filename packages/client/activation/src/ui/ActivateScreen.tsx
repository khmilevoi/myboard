import { notify } from '@reatom/core'
import { bindField } from '@reatom/react'
import {
  AlertCircle,
  AlertTriangle,
  ClockAlert,
  Link2Off,
  Loader2,
  Lock,
  MailCheck,
  QrCode,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { Button } from 'widget-sdk/ui/button'
import { Input } from 'widget-sdk/ui/input'

import { type ActivationModel } from '../model/activation-model'
import { addDeviceRoute, recordScanReturn } from '../model/routes'

import styles from './ActivateScreen.module.css'
import shellStyles from './shell.module.css'

export type ActivateScreenProps = {
  model: ActivationModel
  onScan?: () => void
}

function passkeyButtonContent(loading: boolean, idleLabel: string, loadingLabel: string) {
  if (loading) {
    return (
      <>
        <Loader2 size={16} strokeWidth={2.2} className="animate-spin" aria-hidden />
        {loadingLabel}
      </>
    )
  }
  return (
    <>
      <ShieldCheck size={18} strokeWidth={2} aria-hidden />
      {idleLabel}
    </>
  )
}

type StatusTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

function StatusIcon({
  tone,
  large,
  children,
}: {
  tone: StatusTone
  large?: boolean
  children: ReactNode
}) {
  return (
    <div
      aria-hidden
      className={`${styles.statusIcon} ${styles[`statusIcon_${tone}`]} ${large ? styles.statusIconLarge : ''}`}
    >
      {children}
    </div>
  )
}

// The "принято" / "активировано" tick: a stroke that draws itself in
// (CSS stroke-dashoffset, see .checkDraw), so the confirmation reads as an
// event rather than a static badge.
function DrawnCheck({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5l4.5 4.5L19 7.5"
        pathLength={1}
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={styles.checkDraw}
      />
    </svg>
  )
}

const EXPIRY_FORMAT = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

export const ActivateScreen = reatomMemo<ActivateScreenProps>(
  ({
    model,
    onScan = () => {
      recordScanReturn()
      addDeviceRoute.go({ scan: '1' })
      notify()
    },
  }) => {
    const screen = model.screen()
    const error = model.error()
    const loading = model.loading()
    const expiresAt = model.inviteExpiresAt()
    const nameField = model.registrationForm.fields.name
    const nameError = nameField.validation().error
    const hasNameError = Boolean(nameError)

    // The model owns the transition (`goHome` action); the view just flushes.
    // A model action called from a raw DOM handler still only enqueues a
    // microtask flush by default -- see `@reatom/react`'s own `useAtom` hook,
    // which calls `notify()` right after a write for the same reason. Without
    // it, React's re-render lands one microtask late, which is invisible to a
    // user but trips "not wrapped in act(...)" and fails synchronous
    // assertions in tests.
    function goHome() {
      model.goHome()
      notify()
    }

    const scanButton = (
      <Button
        type="button"
        variant="outline"
        disabled={loading}
        onClick={onScan}
        className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.secondaryButtonGap}`}
      >
        <QrCode size={18} strokeWidth={2} aria-hidden />
        Сканировать QR-код
      </Button>
    )

    const loginCrossLink = (
      <button type="button" disabled={loading} onClick={goHome} className={styles.crossLink}>
        Уже есть passkey? <span className={styles.crossLinkAccent}>Войти</span>
      </button>
    )

    return (
      <>
        {/* Keyed by screen so every state change replays the step-in transition
            (fade + 10px rise), while Shell animates the card height. */}
        <div key={screen} className={styles.step}>
          {screen === 'home' ? (
            <>
              <h1 className={styles.heading}>Вход в myboard</h1>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Используйте passkey или отсканируйте QR-код с другого устройства, где вы уже вошли.
              </p>
              <Button
                type="button"
                disabled={loading}
                onClick={() => model.startLogin()}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                {passkeyButtonContent(loading, 'Войти с passkey', 'Вход…')}
              </Button>
              {scanButton}
              <div className={styles.adminHint}>
                Новое устройство? Запросите ссылку-приглашение у администратора.
              </div>
            </>
          ) : null}

          {screen === 'checking' ? (
            <div role="status" className={styles.statusBlock}>
              <StatusIcon tone="accent">
                <Loader2 size={20} strokeWidth={2.2} className="animate-spin" />
              </StatusIcon>
              <h1 className={styles.heading}>Проверяем приглашение…</h1>
              <div aria-hidden className={styles.skeleton} />
              <div aria-hidden className={`${styles.skeleton} ${styles.skeletonShort}`} />
            </div>
          ) : null}

          {screen === 'activate' ? (
            <>
              <div className={styles.statusBlock}>
                <StatusIcon tone="success">
                  <DrawnCheck size={20} />
                </StatusIcon>
                <h1 className={styles.heading}>Приглашение принято</h1>
                {expiresAt !== null ? (
                  <span className={styles.chip}>
                    <MailCheck size={13} strokeWidth={2.2} aria-hidden />
                    Действует до {EXPIRY_FORMAT.format(expiresAt)}
                  </span>
                ) : null}
              </div>
              <p className={`${styles.description} ${styles.descriptionNew}`}>
                {loading
                  ? 'Подтвердите создание passkey в системном окне.'
                  : 'Осталось создать passkey для этого устройства.'}
              </p>
              <div className={styles.fieldGroup}>
                <Input
                  type="text"
                  placeholder="Ваше имя"
                  aria-label="Ваше имя"
                  aria-invalid={hasNameError}
                  aria-describedby="activate-name-error"
                  disabled={loading}
                  className="h-12 rounded-[13px] px-[15px] text-[15px]"
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') model.startRegistration()
                  }}
                  {...bindField(nameField)}
                />
                <p
                  role="alert"
                  id="activate-name-error"
                  aria-hidden={!hasNameError}
                  className={`${styles.fieldError} ${hasNameError ? '' : styles.fieldErrorHidden} text-destructive`}
                >
                  <AlertCircle size={13} strokeWidth={2.2} aria-hidden />
                  {nameError || ' '}
                </p>
              </div>
              <Button
                type="button"
                disabled={loading}
                onClick={() => model.startRegistration()}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonAfterField}`}
              >
                {passkeyButtonContent(loading, 'Создать passkey', 'Создаём passkey…')}
              </Button>
              {loginCrossLink}
            </>
          ) : null}

          {screen === 'done' ? (
            <div role="status" className={styles.statusBlock}>
              <StatusIcon tone="success" large>
                <DrawnCheck size={26} />
              </StatusIcon>
              <h1 className={styles.heading}>Устройство активировано</h1>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>Открываем доску…</p>
            </div>
          ) : null}

          {screen === 'activate-no-code' ? (
            <>
              <h1 className={styles.heading}>Нужен код приглашения</h1>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                В этой ссылке нет кода приглашения. Запросите новое приглашение у администратора или
                отсканируйте QR-код, который он отправил.
              </p>
              <Button
                type="button"
                onClick={onScan}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                <QrCode size={18} strokeWidth={2} aria-hidden />
                Сканировать QR-код
              </Button>
              {loginCrossLink}
            </>
          ) : null}

          {screen === 'activate-expired' ? (
            <>
              <div className={styles.statusBlock}>
                <StatusIcon tone="warning">
                  <ClockAlert size={20} strokeWidth={2} />
                </StatusIcon>
                <h1 className={styles.heading}>Приглашение истекло</h1>
              </div>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Срок ссылки закончился. Попросите администратора выпустить новое приглашение.
              </p>
              {scanButton}
              {loginCrossLink}
            </>
          ) : null}

          {screen === 'activate-used' ? (
            <>
              <div className={styles.statusBlock}>
                <StatusIcon tone="neutral">
                  <UserCheck size={20} strokeWidth={2} />
                </StatusIcon>
                <h1 className={styles.heading}>Приглашение уже использовано</h1>
              </div>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Его активировали на другом устройстве. Если это были вы — войдите с passkey.
              </p>
              <Button
                type="button"
                disabled={loading}
                onClick={() => model.startLogin()}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                {passkeyButtonContent(loading, 'Войти с passkey', 'Вход…')}
              </Button>
              <button
                type="button"
                disabled={loading}
                onClick={goHome}
                className={styles.crossLink}
              >
                Нет passkey на этом устройстве?{' '}
                <span className={styles.crossLinkAccent}>Перейти к входу</span>
              </button>
            </>
          ) : null}

          {screen === 'activate-not-found' ? (
            <>
              <div className={styles.statusBlock}>
                <StatusIcon tone="danger">
                  <Link2Off size={20} strokeWidth={2} />
                </StatusIcon>
                <h1 className={styles.heading}>Приглашение не найдено</h1>
              </div>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Ссылка неполная или неверная. Отсканируйте QR-код приглашения ещё раз.
              </p>
              <Button
                type="button"
                onClick={onScan}
                className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
              >
                <QrCode size={18} strokeWidth={2} aria-hidden />
                Сканировать QR-код
              </Button>
              {loginCrossLink}
            </>
          ) : null}

          {screen === 'activate-locked' ? (
            <>
              <div className={styles.statusBlock}>
                <StatusIcon tone="danger">
                  <ShieldAlert size={20} strokeWidth={2} />
                </StatusIcon>
                <h1 className={styles.heading}>Слишком много попыток</h1>
              </div>
              <p className={`${styles.description} ${styles.descriptionLogin}`}>
                Приглашение временно заблокировано после нескольких неудачных попыток. Попробуйте
                позже или попросите у администратора новое.
              </p>
              {scanButton}
              {loginCrossLink}
            </>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className={styles.serverError}>
            <AlertTriangle
              size={15}
              strokeWidth={2.2}
              className={styles.serverErrorIcon}
              aria-hidden
            />
            <p className={`${styles.serverErrorText} text-destructive`}>{error}</p>
          </div>
        ) : null}

        <div className={shellStyles.footerNote}>
          <Lock size={12} strokeWidth={2} aria-hidden />
          Защищено passkey на этом устройстве
        </div>
      </>
    )
  },
  'ActivateScreen',
)
