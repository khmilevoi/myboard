import { bindField } from '@reatom/react'
import { AlertCircle, AlertTriangle, Fingerprint, Loader2, Lock } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

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
  const status = model.status()
  const error = model.error()
  const nameField = model.registrationForm.fields.name
  const nameError = nameField.validation().error
  const hasNameError = Boolean(nameError)
  const loading = status === 'pending'

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
          {mode === 'login' ? 'Welcome back' : 'Activate your device'}
        </h1>
        <p
          className={`${styles.description} ${mode === 'login' ? styles.descriptionLogin : styles.descriptionNew}`}
        >
          {mode === 'login'
            ? 'This invite was already used. Sign in with your existing passkey.'
            : 'Create a passkey to finish setting up this device.'}
        </p>

        {mode === 'new-account' ? (
          <div className={styles.fieldGroup}>
            <input
              type="text"
              placeholder="Your name"
              aria-label="Your name"
              aria-invalid={hasNameError}
              aria-describedby="activate-name-error"
              disabled={loading}
              className={`${styles.input} ${hasNameError ? styles.inputError : ''}`}
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

        <button
          type="button"
          disabled={loading}
          onClick={() => (mode === 'new-account' ? model.startRegistration() : model.startLogin())}
          className={`${styles.primaryButton} ${mode === 'new-account' ? styles.primaryButtonAfterField : styles.primaryButtonStandalone}`}
        >
          {mode === 'new-account'
            ? passkeyButtonContent(loading, 'Create passkey', 'Creating passkey…')
            : passkeyButtonContent(loading, 'Sign in with passkey', 'Signing in…')}
        </button>

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
          Secured with a passkey on this device
        </div>
      </div>
    </div>
  )
}, 'ActivateScreen')
