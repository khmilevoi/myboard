import { wrap } from '@reatom/core'
import type { ChangeEvent } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { ProfileFormInput } from '../model/profile-form'
import { StepFrame, WizardActionError, type WizardStepProps } from './WizardSteps'

import styles from './hardware.module.css'
import wizardStyles from './wizard.module.css'

const SEX_OPTIONS = [
  { value: 'male', label: 'Мужской' },
  { value: 'female', label: 'Женский' },
] as const

const FIELD_ERRORS = {
  height: 'Укажите рост в сантиметрах.',
  birthDate: 'Укажите дату рождения в виде ДД.ММ.ГГГГ.',
  sex: 'Выберите пол.',
  save: 'Не получилось сохранить профиль здоровья. Попробуйте ещё раз.',
} as const

const HEIGHT_ID = 'hardware-health-height'
const BIRTH_DATE_ID = 'hardware-health-birth-date'

/** §4(c2): the health profile is incomplete; filled once, saved to the health module, then create. */
export const HealthProfileForm = reatomMemo<WizardStepProps>(({ wizard }) => {
  const step = wizard.step()
  const form = wizard.profileForm()
  const error = wizard.formError()
  const saving = !wizard.saveHealthAndCreate.ready()

  const edit = (patch: Partial<ProfileFormInput>) =>
    wizard.profileForm.set((current) => ({ ...current, ...patch }))

  return (
    <StepFrame
      step={step}
      footer={
        <button
          type="button"
          className={styles.primary}
          data-testid="hardware-health-save"
          disabled={saving}
          onClick={wrap(() => {
            void wizard.saveHealthAndCreate()
          })}
        >
          Сохранить и создать профиль
        </button>
      }
    >
      <div className={`${styles.note} ${styles.noteAccent}`}>
        Весы считают состав тела по росту, возрасту и полу. Заполните их один раз — они сохранятся в
        вашем профиле здоровья.
      </div>
      <div className={wizardStyles.formGrid}>
        <div className={wizardStyles.field}>
          <label className={wizardStyles.fieldLabel} htmlFor={HEIGHT_ID}>
            Рост, см
          </label>
          <input
            id={HEIGHT_ID}
            className={wizardStyles.input}
            data-testid="hardware-health-height"
            inputMode="numeric"
            value={form.height}
            aria-invalid={error === 'height' ? true : undefined}
            onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
              edit({ height: event.target.value }),
            )}
          />
        </div>
        <div className={wizardStyles.field}>
          <label className={wizardStyles.fieldLabel} htmlFor={BIRTH_DATE_ID}>
            Дата рождения
          </label>
          <input
            id={BIRTH_DATE_ID}
            className={wizardStyles.input}
            data-testid="hardware-health-birth-date"
            placeholder="ДД.ММ.ГГГГ"
            value={form.birthDate}
            aria-invalid={error === 'birthDate' ? true : undefined}
            onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
              edit({ birthDate: event.target.value }),
            )}
          />
        </div>
      </div>
      <div className={wizardStyles.field}>
        <span className={wizardStyles.fieldLabel} id="hardware-health-sex">
          Пол
        </span>
        <div
          className={wizardStyles.seg}
          role="group"
          aria-labelledby="hardware-health-sex"
          aria-invalid={error === 'sex' ? true : undefined}
          data-testid="hardware-health-sex"
        >
          {SEX_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={form.sex === option.value}
              onClick={wrap(() => edit({ sex: option.value }))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {error === null ? null : (
        <p className={styles.error} role="alert" data-testid="hardware-health-error">
          {FIELD_ERRORS[error]}
        </p>
      )}
      <WizardActionError wizard={wizard} />
    </StepFrame>
  )
}, 'HealthProfileForm')
