import { bindField } from '@reatom/react'
import { Lock } from 'lucide-react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ThemeToggle } from '@/theme/ui/ThemeToggle'

import { createActivationModel } from '../model/activation-model'

import styles from './ActivateScreen.module.css'

export const ActivateScreen = reatomMemo(() => {
  // One model instance per mounted screen; the activation app has a single
  // route target, so a per-component instance is simplest and keeps tests
  // (which create their own instances) fully isolated from the live UI.
  const [model] = useState(() => createActivationModel())
  const mode = model.mode()
  const status = model.status()
  const error = model.error()
  const nameField = model.registrationForm.fields.name

  return (
    <div className={styles.page}>
      <div className={styles.themeToggle}>
        <ThemeToggle />
      </div>
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
        <p className={styles.description}>
          {mode === 'login'
            ? 'This invite was already used. Sign in with your existing passkey.'
            : 'Create a passkey to finish setting up this device.'}
        </p>

        <div className="mt-6 flex w-full flex-col gap-4">
          {mode === 'new-account' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                model.startRegistration()
              }}
              className="flex flex-col gap-4"
            >
              <Input placeholder="Your name" aria-label="Your name" {...bindField(nameField)} />
              {nameField.validation().error ? (
                <p className="text-sm text-destructive">{nameField.validation().error}</p>
              ) : null}
              <Button type="submit" disabled={status === 'pending'}>
                {status === 'pending' ? 'Creating passkey…' : 'Create passkey'}
              </Button>
            </form>
          ) : (
            <Button
              type="button"
              disabled={status === 'pending'}
              onClick={() => model.startLogin()}
            >
              {status === 'pending' ? 'Signing in…' : 'Sign in with passkey'}
            </Button>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className={styles.footerNote}>
          <Lock size={12} strokeWidth={2} aria-hidden />
          Secured with a passkey on this device
        </div>
      </div>
    </div>
  )
}, 'ActivateScreen')
