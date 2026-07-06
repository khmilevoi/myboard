import { bindField } from '@reatom/react'
import { useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Button } from '../../../src/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../src/components/ui/card'
import { Input } from '../../../src/components/ui/input'
import { createActivationModel } from '../model/activation-model'

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
    <div className="flex min-h-screen items-center justify-center p-4" data-theme="light">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{mode === 'login' ? 'Welcome back' : 'Activate your device'}</CardTitle>
          <CardDescription>
            {mode === 'login'
              ? 'This invite was already used. Sign in with your existing passkey.'
              : 'Create a passkey to finish setting up this device.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {mode === 'new-account' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault()
                model.startRegistration()
              }}
              className="flex flex-col gap-4"
            >
              <Input
                placeholder="Your name"
                aria-label="Your name"
                {...bindField(nameField)}
              />
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
        </CardContent>
      </Card>
    </div>
  )
}, 'ActivateScreen')
