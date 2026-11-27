import { wrap } from '@reatom/core'
import { Check, Clock } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { PhoneSheetBody, PhoneSheetFooter } from 'widget-sdk/ui/phone-sheet'

import type { AddGatewayModel } from '../model/add-gateway-model'

import styles from './hardware.module.css'

export type AddGatewayViewProps = {
  model: AddGatewayModel
  /** «Добавить оборудование»: the dialog opens the wizard on the online gateway. */
  onAddHardware: () => void
  /** «Готово»: back to the list. */
  onDone: () => void
}

/** §3: the one-time code, the wait, and the connected / expired / failed frames. */
export const AddGatewayView = reatomMemo<AddGatewayViewProps>(
  ({ model, onAddHardware, onDone }) => {
    const phase = model.phase()
    const code = model.code()
    const copied = model.copied()
    const error = model.error()
    const countdown = model.countdownLabel()
    const copyBusy = !model.copy.ready()
    const startBusy = !model.start.ready()

    const newCode = (
      <button
        type="button"
        className={styles.primary}
        data-testid="hardware-new-code"
        disabled={startBusy}
        onClick={wrap(() => {
          void model.start()
        })}
      >
        Новый код
      </button>
    )

    if (phase === 'connected') {
      return (
        <>
          <PhoneSheetBody>
            <div className={styles.listBody} data-testid="hardware-add-gateway" data-phase={phase}>
              <div className={styles.empty}>
                <div className={styles.emptyIconOk}>
                  <Check size={24} strokeWidth={2.4} aria-hidden />
                </div>
                <p className={styles.emptyTitle}>Шлюз подключён</p>
                <p className={styles.emptyText}>Raspberry Pi в сети. Теперь можно добавить весы.</p>
              </div>
            </div>
          </PhoneSheetBody>
          <PhoneSheetFooter>
            <div className={styles.footer}>
              <button
                type="button"
                className={styles.primary}
                data-testid="hardware-add-hardware"
                onClick={wrap(onAddHardware)}
              >
                Добавить оборудование
              </button>
              <button
                type="button"
                className={styles.secondary}
                data-testid="hardware-done"
                onClick={wrap(onDone)}
              >
                Готово
              </button>
            </div>
          </PhoneSheetFooter>
        </>
      )
    }

    if (phase === 'expired' || phase === 'failed') {
      const failed = phase === 'failed'
      return (
        <>
          <PhoneSheetBody>
            <div className={styles.listBody} data-testid="hardware-add-gateway" data-phase={phase}>
              <div className={styles.empty}>
                <div className={styles.emptyIconBad}>
                  <Clock size={24} strokeWidth={2} aria-hidden />
                </div>
                <p className={styles.emptyTitle}>
                  {failed ? 'Не удалось получить код' : 'Срок действия кода истёк'}
                </p>
                <p className={styles.emptyText} role={failed ? 'alert' : undefined}>
                  {failed
                    ? (error ?? '')
                    : 'Шлюз так и не подключился. Создайте новый код и запустите шлюз с ним.'}
                </p>
              </div>
            </div>
          </PhoneSheetBody>
          <PhoneSheetFooter>
            <div className={styles.footer}>{newCode}</div>
          </PhoneSheetFooter>
        </>
      )
    }

    // `minting` and `waiting` share the frame; the code and the wait appear once minted.
    return (
      <PhoneSheetBody>
        <div
          className={`${styles.listBody} ${styles.gatewayCodeBody}`}
          data-testid="hardware-add-gateway"
          data-phase={phase}
        >
          <p className={styles.sub}>
            Запустите шлюз на Raspberry Pi и введите этот код, когда он спросит. Код нужен один раз:
            дальше шлюз помнит борду сам.
          </p>
          <div className={styles.codePanel}>
            {code === null ? (
              <p className={styles.codeLoading} role="status">
                Получаем код…
              </p>
            ) : (
              <p className={styles.gatewayCode} data-testid="hardware-gateway-code">
                {code}
              </p>
            )}
          </div>
          <button
            type="button"
            className={styles.secondary}
            data-testid="hardware-copy-code"
            disabled={code === null || copyBusy}
            onClick={wrap(() => {
              void model.copy()
            })}
          >
            {copied ? 'Скопировано' : 'Скопировать код'}
          </button>
          {code === null ? null : (
            <>
              <div className={styles.wait} role="status" data-testid="hardware-waiting">
                <span className={styles.spin} aria-hidden />
                Ждём шлюз…
              </div>
              <p
                className={`${styles.hint} ${styles.hintCentered}`}
                data-testid="hardware-countdown"
              >
                Код активен ещё {countdown}
              </p>
            </>
          )}
        </div>
      </PhoneSheetBody>
    )
  },
  'AddGatewayView',
)
