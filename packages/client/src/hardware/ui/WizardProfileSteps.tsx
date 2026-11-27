import { wrap } from '@reatom/core'
import { CONSENT_CODE_DIGITS } from '@shared/hardware/spike-assumptions'
import { Check, Clock } from 'lucide-react'
import { type ChangeEvent, useState } from 'react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import {
  formatScaleProfileSummary,
  formatSlotsFull,
  formatSlotsUpTo,
  localCalendarDay,
} from '../model/hardware-format'
import type { HardwareModel } from '../model/hardware-model'
import { attachOptions } from '../model/wizard-view'
import { digitsOnly, StepFrame, WizardActionError, type WizardStepProps } from './WizardSteps'

import styles from './hardware.module.css'
import wizardStyles from './wizard.module.css'

export type WizardHardwareStepProps = WizardStepProps & { hardware: HardwareModel }

// Not drawn: the create option when the health profile is not filled in yet (flag for design sync).
const CREATE_NEEDS_PROFILE = 'рост, возраст и пол — заполните один раз'

/** §4(c) create or attach, §4(c5) every slot taken. */
export const ProfileChoiceStep = reatomMemo<WizardHardwareStepProps>(({ wizard, hardware }) => {
  const step = wizard.step()
  // Read so the health profile stays subscribed while this step is open: `create` treats an
  // unloaded profile as missing.
  const healthProfile = wizard.healthProfile()
  const [picked, setPicked] = useState<'create' | 'attach'>('create')
  if (step.kind !== 'profileChoice') return null
  const choice = step.slotsFull ? 'attach' : picked
  const creating = !wizard.create.ready()

  const createSub = step.slotsFull
    ? formatSlotsFull()
    : healthProfile === null
      ? CREATE_NEEDS_PROFILE
      : `${formatScaleProfileSummary(healthProfile, localCalendarDay(hardware.now()))} — из вашего профиля`

  return (
    <StepFrame
      step={step}
      footer={
        <button
          type="button"
          className={styles.primary}
          data-testid="hardware-wizard-profile-next"
          disabled={creating}
          onClick={wrap(() => {
            if (choice === 'attach') {
              wizard.openAttach()
              return
            }
            void wizard.create()
          })}
        >
          {choice === 'create' ? 'Создать профиль' : 'Дальше'}
        </button>
      }
    >
      <p className={wizardStyles.sub}>
        {`На весах ${formatSlotsUpTo().toLowerCase()}, по одному на человека. По профилю весы понимают, чьё взвешивание, и считают состав тела.`}
      </p>
      <div className={wizardStyles.options}>
        <button
          type="button"
          className={wizardStyles.option}
          data-testid="hardware-wizard-option-create"
          aria-pressed={choice === 'create'}
          disabled={step.slotsFull || creating}
          onClick={() => setPicked('create')}
        >
          <span className={wizardStyles.radio} aria-hidden />
          <span className={wizardStyles.optionBody}>
            <span className={wizardStyles.optionTitle}>Создать новый профиль</span>
            <span className={wizardStyles.optionSub}>{createSub}</span>
          </span>
        </button>
        <button
          type="button"
          className={wizardStyles.option}
          data-testid="hardware-wizard-option-attach"
          aria-pressed={choice === 'attach'}
          disabled={creating}
          onClick={() => setPicked('attach')}
        >
          <span className={wizardStyles.radio} aria-hidden />
          <span className={wizardStyles.optionBody}>
            <span className={wizardStyles.optionTitle}>Подключить существующий</span>
            <span className={wizardStyles.optionSub}>понадобится код согласия этого профиля</span>
          </span>
        </button>
      </div>
      <WizardActionError wizard={wizard} />
    </StepFrame>
  )
}, 'ProfileChoiceStep')

const CONSENT_INPUT_ID = 'hardware-wizard-consent'
const CONSENT_NOTE_ID = 'hardware-wizard-consent-note'
// Decision 20.
const PROFILE_BOUND = 'Этот профиль уже привязан к другому аккаунту.'

/** §4(c3) pick a free profile and type its consent code, §4(c4) the scale rejected the code. */
export const AttachStep = reatomMemo<WizardHardwareStepProps>(({ wizard, hardware }) => {
  const step = wizard.step()
  const snapshot = hardware.snapshot.data()
  const consent = wizard.consent()
  if (step.kind !== 'attach') return null
  const options = attachOptions(step.hardwareId, snapshot)
  const attaching = !wizard.attach.ready()
  const rejected = step.error === 'consent'

  return (
    <StepFrame
      step={step}
      footer={
        <button
          type="button"
          className={styles.primary}
          data-testid="hardware-wizard-attach"
          disabled={step.index === null || !wizard.consentValid() || attaching}
          onClick={wrap(() => {
            void wizard.attach()
          })}
        >
          Подключить профиль
        </button>
      }
    >
      <h3 className={styles.label}>Профили на весах</h3>
      <div className={wizardStyles.options}>
        {options.map((option) => (
          <button
            key={option.index}
            type="button"
            className={wizardStyles.option}
            data-testid={`hardware-wizard-profile-${option.index}`}
            aria-pressed={step.index === option.index}
            disabled={!option.selectable || attaching}
            onClick={wrap(() => wizard.selectIndex(option.index))}
          >
            <span className={wizardStyles.radio} aria-hidden />
            <span className={wizardStyles.optionBody}>
              <span className={wizardStyles.optionTitle}>{`Профиль ${option.index}`}</span>
              <span className={wizardStyles.optionSub}>{option.detail}</span>
            </span>
          </button>
        ))}
      </div>
      {step.error === 'bound' ? (
        <p className={styles.error} role="alert">
          {PROFILE_BOUND}
        </p>
      ) : null}
      <div className={wizardStyles.field}>
        <label className={wizardStyles.fieldLabel} htmlFor={CONSENT_INPUT_ID}>
          Код согласия
        </label>
        <input
          id={CONSENT_INPUT_ID}
          className={`${wizardStyles.input} ${wizardStyles.inputCode}`}
          data-testid="hardware-wizard-consent"
          inputMode="numeric"
          autoComplete="off"
          maxLength={CONSENT_CODE_DIGITS}
          value={consent}
          aria-invalid={rejected ? true : undefined}
          aria-describedby={CONSENT_NOTE_ID}
          onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
            wizard.consent.set(digitsOnly(event.target.value)),
          )}
        />
        {rejected ? (
          <p id={CONSENT_NOTE_ID} className={wizardStyles.fieldError}>
            Весы не приняли код. Проверьте его в «Оборудовании» борды, где создавали профиль.
          </p>
        ) : (
          <p id={CONSENT_NOTE_ID} className={styles.hint}>
            Его показали при создании профиля. Если профиль создавали на другой борде, код есть в её
            «Оборудовании».
          </p>
        )}
      </div>
      <WizardActionError wizard={wizard} />
    </StepFrame>
  )
}, 'AttachStep')

const WRITING_COPY = {
  create: {
    title: 'Создаём профиль на весах',
    text: 'Шлюз передаёт рост, дату рождения и пол. Весам нужно не спать — если экран погас, встаньте на них.',
  },
  // Decision 20.
  attach: {
    title: 'Подключаем профиль',
    text: 'Шлюз проверяет код согласия на весах. Весам нужно не спать — если экран погас, встаньте на них.',
  },
} as const

/** §4(c6): the gateway is writing to the scale. */
export const WritingStep = reatomMemo<WizardStepProps>(({ wizard }) => {
  const step = wizard.step()
  if (step.kind !== 'writing') return null
  const copy = WRITING_COPY[step.mode]
  return (
    <StepFrame step={step}>
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>{copy.title}</p>
        <p className={styles.emptyText}>{copy.text}</p>
      </div>
      <div className={styles.wait} role="status" data-testid="hardware-wizard-writing">
        <span className={styles.spin} aria-hidden />
        Ждём ответ весов…
      </div>
    </StepFrame>
  )
}, 'WritingStep')

const SILENT_TEXT = {
  create:
    'Профиль не создан. Весы сопряжены, так что начинать сначала не нужно: разбудите их и попробуйте ещё раз.',
  // Not drawn: the attach variant (flag for design sync).
  attach:
    'Профиль не подключён. Весы сопряжены, так что начинать сначала не нужно: разбудите их и попробуйте ещё раз.',
} as const

/** §4(c7): no answer from the scale. */
export const ScaleSilentStep = reatomMemo<WizardStepProps>(({ wizard }) => {
  const step = wizard.step()
  if (step.kind !== 'scaleSilent') return null
  const retrying = !wizard.retry.ready()
  return (
    <StepFrame
      step={step}
      footer={
        <>
          <button
            type="button"
            className={styles.primary}
            data-testid="hardware-wizard-retry"
            disabled={retrying}
            onClick={wrap(() => {
              void wizard.retry()
            })}
          >
            Попробовать ещё раз
          </button>
          <button
            type="button"
            className={styles.secondary}
            data-testid="hardware-wizard-silent-back"
            disabled={retrying}
            onClick={wrap(() => wizard.back())}
          >
            Назад
          </button>
        </>
      }
    >
      <div className={styles.empty}>
        <div className={styles.emptyIconBad}>
          <Clock size={24} strokeWidth={2} aria-hidden />
        </div>
        <p className={styles.emptyTitle}>Весы не ответили</p>
        <p className={styles.emptyText}>{SILENT_TEXT[step.mode]}</p>
      </div>
      <WizardActionError wizard={wizard} />
    </StepFrame>
  )
}, 'ScaleSilentStep')

export type DoneStepProps = WizardStepProps & {
  /** §4(d2) «Добавить карточку «Вес»». */
  onAddWeightCard: () => void
  /** «Готово»: back to the list. */
  onDone: () => void
}

/** §4(d) connected, §4(d2) connected and the board has no weight card yet. */
export const DoneStep = reatomMemo<DoneStepProps>(({ wizard, onAddWeightCard, onDone }) => {
  const step = wizard.step()
  const needsCard = wizard.boardNeedsWeightCard()
  if (step.kind !== 'done') return null

  const done = (
    <button
      type="button"
      className={needsCard ? styles.secondary : styles.primary}
      data-testid="hardware-wizard-done"
      onClick={wrap(onDone)}
    >
      Готово
    </button>
  )

  return (
    <StepFrame
      step={step}
      footer={
        needsCard ? (
          <>
            <button
              type="button"
              className={styles.primary}
              data-testid="hardware-wizard-add-weight"
              onClick={wrap(onAddWeightCard)}
            >
              Добавить карточку «Вес»
            </button>
            {done}
          </>
        ) : (
          done
        )
      }
    >
      <div className={`${styles.empty} ${wizardStyles.doneEmpty}`}>
        <div className={styles.emptyIconOk}>
          <Check size={24} strokeWidth={2.4} aria-hidden />
        </div>
        <p className={styles.emptyTitle}>Весы подключены</p>
        <p className={styles.emptyText}>
          {needsCard
            ? 'Взвешивания уже сохраняются в вашем профиле здоровья. Чтобы видеть вес на борде, добавьте карточку «Вес».'
            : 'Встаньте на весы — вес появится на карточке «Вес».'}
        </p>
      </div>
      <div className={wizardStyles.codeBox}>
        <div className={wizardStyles.codeBoxText}>
          <p className={wizardStyles.codeBoxTitle}>{`Код согласия · профиль ${step.index}`}</p>
          <p className={styles.hint}>
            Нужен, чтобы подключить этот профиль на другой борде. Посмотреть его можно в
            «Оборудовании».
          </p>
        </div>
        {step.consentCode === null ? null : (
          <span className={wizardStyles.code} data-testid="hardware-wizard-code">
            {step.consentCode}
          </span>
        )}
      </div>
    </StepFrame>
  )
}, 'DoneStep')
