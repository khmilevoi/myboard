import { bindField } from '@reatom/react'
import { AlertCircle, AlertTriangle, Fingerprint, Loader2, Lock } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { createActivationModel } from '../model/activation-model'
import { ThemeTogglePill } from './ThemeTogglePill'

import styles from './ActivateScreen.module.css'

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
      <Fingerprint size={18} strokeWidth={2} aria-hidden />
      {idleLabel}
    </>
  )
}

export const ActivateScreen = reatomMemo(() => {
  // One model instance per mounted screen; the activation app has a single
  // route target, so a per-component instance is simplest and keeps tests
  // (which create their own instances) fully isolated from the live UI.
  const [model] = useState(() => createActivationModel())
  const mode = model.mode()
  const error = model.error()
  const nameField = model.registrationForm.fields.name
  const nameError = nameField.validation().error
  const hasNameError = Boolean(nameError)
  const loading = model.loading()

  return (
    <div className={styles.page}>
      <ThemeTogglePill />
      <div className={styles.card}>
        <div aria-hidden className={styles.brandMark}>
          <div className={styles.brandCell} />
          <div className={styles.brandCellDim} />
          <div className={styles.brandCellDim} />
          <div className={styles.brandCell} />
        </div>
        <div className={styles.brandLabel}>myboard</div>

        <h1 className={styles.heading}>
          {mode === 'login' ? 'С возвращением' : 'Активируйте устройство'}
        </h1>
        <p
          className={`${styles.description} ${mode === 'login' ? styles.descriptionLogin : styles.descriptionNew}`}
        >
          {mode === 'login'
            ? 'Это приглашение уже использовано. Войдите с помощью существующего ключа доступа.'
            : 'Создайте ключ доступа, чтобы завершить настройку этого устройства.'}
        </p>

        {mode === 'new-account' ? (
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
        ) : null}

        <Button
          type="button"
          disabled={loading}
          onClick={() => (mode === 'new-account' ? model.startRegistration() : model.startLogin())}
          className={`h-12 w-full gap-[9px] rounded-[13px] text-[15px] font-semibold ${mode === 'new-account' ? styles.primaryButtonAfterField : styles.primaryButtonStandalone}`}
        >
          {mode === 'new-account'
            ? passkeyButtonContent(loading, 'Создать ключ доступа', 'Создание ключа доступа…')
            : passkeyButtonContent(loading, 'Войти с ключом доступа', 'Вход…')}
        </Button>

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

        <div className={styles.footerNote}>
          <Lock size={12} strokeWidth={2} aria-hidden />
          Устройство защищено ключом доступа
        </div>
      </div>
    </div>
  )
}, 'ActivateScreen')
