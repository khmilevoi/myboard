import { wrap } from '@reatom/core'
import { HARDWARE_MODELS } from '@shared/hardware/models'
import { PAIRING_PIN_DIGITS } from '@shared/hardware/spike-assumptions'
import { Cpu, Scale, X } from 'lucide-react'
import type { ChangeEvent, ReactNode } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { PhoneSheetBody, PhoneSheetFooter } from 'widget-sdk/ui/phone-sheet'

import { formatSignal } from '../model/hardware-format'
import type { WizardModel, WizardStep } from '../model/wizard-model'
import { WIZARD_STAGES, wizardStageIndex } from '../model/wizard-view'

import styles from './hardware.module.css'
import wizardStyles from './wizard.module.css'

/** Keeps only digits: the PIN and the consent code are numeric. */
export const digitsOnly = (value: string) => value.replace(/\D/g, '')

const KIND_LABELS = { scale: 'весы' } as const

export type WizardStepperProps = { step: WizardStep }

/** «Поиск · Сопряжение · Профиль»; hidden on the done step. */
export const WizardStepper = reatomMemo<WizardStepperProps>(({ step }) => {
  const current = wizardStageIndex(step)
  if (current === null) return null
  return (
    <ol
      className={wizardStyles.steps}
      aria-label={`Шаг ${current + 1} из ${WIZARD_STAGES.length}`}
      data-testid="hardware-wizard-stepper"
    >
      {WIZARD_STAGES.map((label, index) => (
        <li
          key={label}
          className={wizardStyles.stage}
          data-state={index < current ? 'done' : index === current ? 'now' : 'next'}
          aria-current={index === current ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  )
}, 'WizardStepper')

export type StepFrameProps = {
  step: WizardStep
  offline?: boolean
  children: ReactNode
  /** The step's buttons, pinned to the bottom on phones. */
  footer?: ReactNode
}

/** Body (stepper + the step) and footer of one wizard step. */
export const StepFrame = reatomMemo<StepFrameProps>(
  ({ step, offline = false, children, footer }) => (
    <>
      <PhoneSheetBody>
        <div
          className={wizardStyles.body}
          data-testid="hardware-wizard"
          data-step={step.kind}
          data-offline={offline ? 'true' : undefined}
        >
          <WizardStepper step={step} />
          {children}
        </div>
      </PhoneSheetBody>
      {footer === undefined ? null : (
        <PhoneSheetFooter>
          <div className={styles.footer}>{footer}</div>
        </PhoneSheetFooter>
      )}
    </>
  ),
  'StepFrame',
)

export type WizardStepProps = { wizard: WizardModel }

/** The model's last failed request, under the step it belongs to. */
export const WizardActionError = reatomMemo<WizardStepProps>(({ wizard }) => {
  const error = wizard.actionError()
  if (error === null) return null
  return (
    <p className={styles.error} role="alert" data-testid="hardware-wizard-error">
      {error}
    </p>
  )
}, 'WizardActionError')

/** §4(a) the scan with its results, §4(a2) nothing found. */
export const ScanStep = reatomMemo<WizardStepProps>(({ wizard }) => {
  const step = wizard.step()
  const nothingFound = wizard.nothingFound()

  if (nothingFound) {
    return (
      <StepFrame
        step={step}
        footer={
          <button
            type="button"
            className={styles.primary}
            data-testid="hardware-wizard-rescan"
            disabled={!wizard.rescan.ready()}
            onClick={wrap(() => {
              void wizard.rescan()
            })}
          >
            Искать ещё раз
          </button>
        }
      >
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>Весы не нашлись</p>
          <p className={styles.emptyText}>
            Проверьте, что весы проснулись и горит экран. Если весы сопряжены с телефоном, выключите
            на нём Bluetooth: весы говорят только с одним устройством сразу.
          </p>
        </div>
      </StepFrame>
    )
  }

  const results = wizard.results()
  // Also while the start request itself is out (before the 202 and the active scan record).
  const scanning = wizard.scanning() || !wizard.openScan.ready() || !wizard.rescan.ready()
  const choosing = !wizard.choose.ready()

  return (
    <StepFrame step={step}>
      <p className={wizardStyles.sub}>
        Встаньте на весы, чтобы они проснулись. Показываем только модели, которые борда умеет
        читать.
      </p>
      {results.length > 0 ? (
        <>
          <h3 className={styles.label}>Рядом</h3>
          {results.map((result) => {
            const model = HARDWARE_MODELS[result.model]
            return (
              <div
                key={result.address}
                className={styles.row}
                data-testid={`hardware-scan-${result.address}`}
              >
                <div className={cn(styles.tile, styles.tileOn)}>
                  <Scale size={18} strokeWidth={1.8} aria-hidden />
                </div>
                <div className={styles.rowBody}>
                  <p className={styles.rowTitle}>{model.label}</p>
                  <p className={styles.rowSub}>
                    {`${KIND_LABELS[model.kind]} · ${formatSignal(result.rssi)}`}
                  </p>
                </div>
                <button
                  type="button"
                  className={styles.btnPrimary}
                  disabled={choosing}
                  onClick={wrap(() => {
                    void wizard.choose(result.address)
                  })}
                >
                  Выбрать
                </button>
              </div>
            )
          })}
        </>
      ) : null}
      {scanning ? (
        <div
          className={cn(styles.wait, wizardStyles.waitStart)}
          role="status"
          data-testid="hardware-wizard-scanning"
        >
          <span className={styles.spin} aria-hidden />
          Ищем…
        </div>
      ) : null}
    </StepFrame>
  )
}, 'ScanStep')

const PIN_INPUT_ID = 'hardware-wizard-pin'
const PIN_NOTE_ID = 'hardware-wizard-pin-note'

/** §4(b) the PIN from the scale's screen, §4(b2) a rejected PIN. */
export const PairingStep = reatomMemo<WizardStepProps>(({ wizard }) => {
  const step = wizard.step()
  if (step.kind !== 'pairing') return null
  const pin = wizard.pin()
  const enabled = wizard.pinEnabled()
  const submitting = !wizard.submitPin.ready()
  const rejected = step.stage === 'pin_rejected'
  const connecting = step.pairingId === null || step.stage === 'connecting'

  return (
    <StepFrame
      step={step}
      footer={
        <button
          type="button"
          className={styles.primary}
          data-testid="hardware-wizard-pair"
          disabled={!enabled || !wizard.pinValid() || submitting}
          onClick={wrap(() => {
            void wizard.submitPin()
          })}
        >
          Сопрячь
        </button>
      }
    >
      <div className={wizardStyles.field}>
        <label className={wizardStyles.fieldLabel} htmlFor={PIN_INPUT_ID}>
          Код с экрана весов
        </label>
        <input
          id={PIN_INPUT_ID}
          className={cn(wizardStyles.input, wizardStyles.inputPin)}
          data-testid="hardware-wizard-pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={PAIRING_PIN_DIGITS}
          value={pin}
          aria-invalid={rejected ? true : undefined}
          aria-describedby={PIN_NOTE_ID}
          onChange={wrap((event: ChangeEvent<HTMLInputElement>) =>
            wizard.pin.set(digitsOnly(event.target.value)),
          )}
        />
        {rejected ? (
          <p id={PIN_NOTE_ID} className={wizardStyles.fieldError}>
            Код не подошёл. Весы покажут новый — введите его.
          </p>
        ) : (
          <p id={PIN_NOTE_ID} className={styles.hint} role={connecting ? 'status' : undefined}>
            {connecting ? 'Подключаемся к весам…' : 'Весы показывают его, пока идёт сопряжение.'}
          </p>
        )}
      </div>
      <WizardActionError wizard={wizard} />
    </StepFrame>
  )
}, 'PairingStep')

/** §4(b3): the pairing failed; a fresh scan on the same gateway. */
export const PairingFailedStep = reatomMemo<WizardStepProps>(({ wizard }) => {
  const step = wizard.step()
  const gatewayId = wizard.gatewayId()
  return (
    <StepFrame
      step={step}
      footer={
        <button
          type="button"
          className={styles.primary}
          data-testid="hardware-wizard-restart"
          disabled={gatewayId === null || !wizard.openScan.ready()}
          onClick={wrap(() => {
            if (gatewayId !== null) void wizard.openScan(gatewayId)
          })}
        >
          Начать заново
        </button>
      }
    >
      <div className={styles.empty}>
        <div className={styles.emptyIconBad}>
          <X size={24} strokeWidth={2} aria-hidden />
        </div>
        <p className={styles.emptyTitle}>Сопряжение не удалось</p>
        <p className={styles.emptyText}>
          Весы уснули или код не ввели вовремя. Разбудите весы и начните с поиска — они покажут
          новый код.
        </p>
      </div>
    </StepFrame>
  )
}, 'PairingFailedStep')

export type OfflineStepProps = WizardStepProps & { onClose: () => void }

/** §4(e): the gateway dropped; the step resumes by itself when it is back. */
export const OfflineStep = reatomMemo<OfflineStepProps>(({ wizard, onClose }) => {
  const step = wizard.step()
  return (
    <StepFrame
      step={step}
      offline
      footer={
        <button
          type="button"
          className={styles.secondary}
          data-testid="hardware-wizard-offline-close"
          onClick={wrap(onClose)}
        >
          Закрыть
        </button>
      }
    >
      <div className={styles.empty} data-testid="hardware-wizard-offline">
        <div className={wizardStyles.offlineIcon}>
          <Cpu size={24} strokeWidth={1.8} aria-hidden />
        </div>
        <p className={styles.emptyTitle}>Шлюз не в сети</p>
        <p className={styles.emptyText}>
          Связь с Raspberry Pi пропала, до весов сейчас не достучаться. Когда шлюз вернётся, шаг
          продолжится; если весы успеют уснуть, сопряжение начнётся заново.
        </p>
      </div>
      <div className={styles.wait} role="status">
        <span className={styles.spin} aria-hidden />
        Ждём шлюз…
      </div>
    </StepFrame>
  )
}, 'OfflineStep')
