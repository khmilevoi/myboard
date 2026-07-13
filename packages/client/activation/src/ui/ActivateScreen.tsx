import { notify } from '@reatom/core'
import { bindField } from '@reatom/react'
import { AlertCircle, AlertTriangle, Loader2, Lock, QrCode, ShieldCheck } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

    return (
      <>
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

        {screen === 'activate' ? (
          <>
            <h1 className={styles.heading}>Активация устройства</h1>
            <p className={`${styles.description} ${styles.descriptionNew}`}>
              Создайте passkey, чтобы завершить настройку этого устройства.
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
              {passkeyButtonContent(loading, 'Создать passkey', 'Создание passkey…')}
            </Button>
            {scanButton}
            <button type="button" disabled={loading} onClick={goHome} className={styles.crossLink}>
              Уже активировано? <span className={styles.crossLinkAccent}>Войти с passkey</span>
            </button>
          </>
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
            <button type="button" onClick={goHome} className={styles.crossLink}>
              Уже есть passkey? <span className={styles.crossLinkAccent}>Войти</span>
            </button>
          </>
        ) : null}

        {screen === 'activate-used' ? (
          <>
            <h1 className={styles.heading}>Приглашение уже использовано</h1>
            <p className={`${styles.description} ${styles.descriptionLogin}`}>
              Эта ссылка-приглашение уже была активирована на другом устройстве. Запросите новое
              приглашение у администратора.
            </p>
            <Button
              type="button"
              disabled={loading}
              onClick={() => model.startLogin()}
              className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${styles.primaryButtonStandalone}`}
            >
              {passkeyButtonContent(loading, 'Войти с passkey', 'Вход…')}
            </Button>
            <button type="button" disabled={loading} onClick={goHome} className={styles.crossLink}>
              Нет passkey на этом устройстве?{' '}
              <span className={styles.crossLinkAccent}>Перейти к входу</span>
            </button>
          </>
        ) : null}

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
