import { wrap } from '@reatom/core'
import { Cpu, Plus } from 'lucide-react'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'
import { PhoneSheetBody, PhoneSheetFooter } from 'widget-sdk/ui/phone-sheet'

import type { HardwareModel } from '../model/hardware-model'
import { AdoptableCard, GatewayItem, HardwareCard } from './HardwareRows'

import styles from './hardware.module.css'

export type HardwareListProps = {
  model: HardwareModel
  onAddGateway: () => void
  onAddHardware: () => void
  /** «Подключить профиль» on a scale that has none of the account's profiles. */
  onConnectProfile: (hardwareId: string) => void
}

const OFFLINE_NOTE =
  'Проверьте, что Raspberry Pi включён и шлюз запущен. Взвешивания не потеряются: весы хранят их, пока шлюз не заберёт.'
const NO_GATEWAY_NOTE =
  'Шлюза сейчас нет. Весы и профили остались на борде: подключите Raspberry Pi новым кодом — и взвешивания пойдут снова, без сопряжения.'
const ADOPT_NOTE =
  'Сопрягать заново не нужно. После добавления подключите свой профиль на весах кодом согласия. Код можно посмотреть в «Оборудовании» прежней борды.'
const OFFLINE_HINT =
  'Добавлять оборудование и отключать весы можно, когда шлюз в сети. Код согласия и отвязка профиля работают и сейчас.'
const CODE_HINT = 'Код видите только вы. Другие участники борды его не получают.'
const LOAD_ERROR = 'Не удалось загрузить оборудование. Попробуйте позже.'

/**
 * The list view (§2): body and footer for the dialog's `list` view. Everything comes from
 * `model.window`; the view only decides which §2 frame the data is.
 */
export const HardwareList = reatomMemo<HardwareListProps>(
  ({ model, onAddGateway, onAddHardware, onConnectProfile }) => {
    const hardwareWindow = model.window()
    const loadError = model.snapshot.error()
    const confirmOpen = model.confirm() !== null
    const actionError = model.actionError()
    const codeShown = model.revealed() !== null

    if (hardwareWindow === null) {
      return (
        <PhoneSheetBody>
          <div className={styles.listBody} data-testid="hardware-list">
            {loadError === undefined ? (
              <p className={styles.hint} role="status">
                Загружаем…
              </p>
            ) : (
              <p className={styles.error} role="alert">
                {LOAD_ERROR}
              </p>
            )}
          </div>
        </PhoneSheetBody>
      )
    }

    const { gateways, attached, detached, returnable, adoptable, primary } = hardwareWindow
    const gatewayOnline = (id: string) => gateways.find((gateway) => gateway.id === id)?.online
    const adoptGroups = [...new Set(adoptable.map((row) => row.gatewayLabel))]

    return (
      <>
        <PhoneSheetBody>
          <div className={styles.listBody} data-testid="hardware-list">
            {!confirmOpen && actionError !== null ? (
              <p className={styles.error} role="alert" data-testid="hardware-action-error">
                {actionError}
              </p>
            ) : null}

            {hardwareWindow.empty ? (
              <div className={styles.empty}>
                <div className={styles.emptyIcon}>
                  <Cpu size={24} strokeWidth={1.8} aria-hidden />
                </div>
                <p className={styles.emptyTitle}>Сначала нужен шлюз</p>
                <p className={styles.emptyText}>
                  Шлюз — небольшая программа на Raspberry Pi рядом с весами. Через неё борда говорит
                  с ними по Bluetooth.
                </p>
              </div>
            ) : null}

            {gateways.length === 0 && detached.length > 0 ? (
              <div className={styles.note}>{NO_GATEWAY_NOTE}</div>
            ) : null}

            {gateways.length > 0 ? (
              <>
                <h3 className={styles.label}>Шлюз</h3>
                {gateways.map((gateway) => (
                  <div key={gateway.id}>
                    <GatewayItem model={model} gateway={gateway} />
                    {gateway.online ? null : (
                      <div className={styles.note} data-testid="hardware-offline-note">
                        {OFFLINE_NOTE}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : null}

            {attached.length > 0 ? (
              <>
                <h3 className={styles.label}>Подключено</h3>
                <div className={styles.cards}>
                  {attached.map((row) => (
                    <HardwareCard
                      key={row.id}
                      model={model}
                      row={row}
                      mode="attached"
                      onConnectProfile={onConnectProfile}
                    />
                  ))}
                </div>
              </>
            ) : null}

            {adoptGroups.map((label) => (
              <div key={label}>
                <h3 className={styles.label}>{`Уже сопряжено с ${label}`}</h3>
                <div className={styles.cards}>
                  {adoptable
                    .filter((row) => row.gatewayLabel === label)
                    .map((row) => (
                      <AdoptableCard
                        key={`${row.gatewayId}|${row.address}`}
                        model={model}
                        row={row}
                        gatewayOnline={gatewayOnline(row.gatewayId) === true}
                      />
                    ))}
                </div>
              </div>
            ))}
            {adoptable.length > 0 ? (
              <div className={`${styles.note} ${styles.noteAccent}`}>{ADOPT_NOTE}</div>
            ) : null}

            {detached.length > 0 ? (
              <>
                <h3 className={styles.label}>Ждут шлюз</h3>
                <div className={styles.cards}>
                  {detached.map((row) => (
                    <HardwareCard key={row.id} model={model} row={row} mode="detached" />
                  ))}
                </div>
              </>
            ) : null}

            {returnable.length > 0 ? (
              <>
                <h3 className={styles.label}>Уже были на этой борде</h3>
                <div className={styles.cards}>
                  {returnable.map(({ gatewayId, hardware }) => (
                    <HardwareCard
                      key={hardware.id}
                      model={model}
                      row={hardware}
                      mode="returnable"
                      action={{
                        label: 'Вернуть',
                        disabled: !hardware.gatewayOnline || !model.adopt.ready(),
                        onClick: () => {
                          void model.adopt(gatewayId, hardware.address)
                        },
                      }}
                    />
                  ))}
                </div>
                <div className={`${styles.note} ${styles.noteAccent}`}>
                  {`${returnable[0]!.gatewayLabel} помнит эти весы. После «Вернуть» профили привяжутся как раньше — ни сопряжения, ни кода согласия не нужно.`}
                </div>
              </>
            ) : null}

            {codeShown ? <p className={styles.hint}>{CODE_HINT}</p> : null}
          </div>
        </PhoneSheetBody>

        {primary === null ? null : (
          <PhoneSheetFooter>
            <div className={styles.footer}>
              {primary === 'addGateway' ? (
                <button
                  type="button"
                  className={styles.primary}
                  data-testid="hardware-primary"
                  onClick={wrap(() => onAddGateway())}
                >
                  <Plus size={16} strokeWidth={2.2} aria-hidden />
                  Добавить шлюз
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.primary}
                    data-testid="hardware-primary"
                    disabled={!hardwareWindow.addHardwareEnabled}
                    aria-describedby={
                      hardwareWindow.addHardwareEnabled ? undefined : 'hardware-offline-hint'
                    }
                    onClick={wrap(() => onAddHardware())}
                  >
                    <Plus size={16} strokeWidth={2.2} aria-hidden />
                    Добавить оборудование
                  </button>
                  {hardwareWindow.addHardwareEnabled ? null : (
                    <p
                      id="hardware-offline-hint"
                      className={`${styles.hint} ${styles.hintCentered}`}
                      data-testid="hardware-primary-hint"
                    >
                      {OFFLINE_HINT}
                    </p>
                  )}
                </>
              )}
            </div>
          </PhoneSheetFooter>
        )}
      </>
    )
  },
  'HardwareList',
)
