import { wrap } from '@reatom/core'
import { Cpu, Scale, TriangleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import type { HardwareModel } from '../model/hardware-model'
import type {
  AdoptRow,
  GatewayRow as GatewayRowData,
  HardwareRow,
  ProfileRow,
} from '../model/hardware-view'
import { ConfirmRow } from './ConfirmRow'

import styles from './hardware.module.css'

type ModelProps = { model: HardwareModel }

const LOW_BATTERY_NOTE =
  'Батарея весов садится. Замените батарейки, пока весы не перестали передавать взвешивания.'

function revokeText(label: string) {
  return (
    <>
      <b>Отозвать шлюз?</b> {label} перестанет связываться с этой бордой, взвешивания перестанут
      приходить. Весы, профили и коды согласия останутся на борде: когда этот Pi подключится новым
      кодом, весы вернутся без сопряжения.
    </>
  )
}

function unpairText(title: string) {
  return (
    <>
      <b>Отключить {title}?</b> Сопряжение разорвётся, профили отвяжутся у всех участников. Чтобы
      вернуть весы, их придётся сопрячь заново.
    </>
  )
}

function removeText(title: string) {
  return (
    <>
      <b>Убрать {title} с борды?</b> Профили отвяжутся у всех участников, а их коды согласия
      пропадут — на другой борде профиль тогда не подключить. Сопряжение на Raspberry Pi останется.
    </>
  )
}

function unbindText(index: number) {
  return (
    <>
      <b>Отвязать профиль {index}?</b> Новые взвешивания перестанут приходить в ваш аккаунт. Профиль
      останется на весах, прошлые измерения — у вас.
    </>
  )
}

/** «в сети · на связи только что» → «на связи только что»: the part after the status word. */
function statusDetail(statusLabel: string): string {
  const at = statusLabel.indexOf(' · ')
  return at === -1 ? '' : statusLabel.slice(at + 3)
}

/** The open confirm's row, wired to the model: busy while its request runs, errors under it. */
const ModelConfirmRow = reatomMemo<ModelProps & { text: ReactNode; confirmLabel: string }>(
  ({ model, text, confirmLabel }) => (
    <ConfirmRow
      text={text}
      confirmLabel={confirmLabel}
      busy={!model.confirmAction.ready()}
      error={model.actionError()}
      onCancel={wrap(() => model.confirm.set(null))}
      onConfirm={wrap(() => {
        void model.confirmAction()
      })}
    />
  ),
  'ModelConfirmRow',
)

export const GatewayItem = reatomMemo<ModelProps & { gateway: GatewayRowData }>(
  ({ model, gateway }) => {
    const confirm = model.confirm()
    const testId = `hardware-gateway-${gateway.id}`
    if (confirm?.kind === 'revokeGateway' && confirm.gatewayId === gateway.id) {
      return (
        <div data-testid={testId}>
          <ModelConfirmRow model={model} text={revokeText(gateway.label)} confirmLabel="Отозвать" />
        </div>
      )
    }
    return (
      <div className={styles.row} data-testid={testId}>
        <div className={styles.tile}>
          <Cpu size={18} strokeWidth={1.8} aria-hidden />
        </div>
        <div className={styles.rowBody}>
          <p className={styles.rowTitle}>{gateway.label}</p>
          <p className={styles.rowSub}>
            <span
              className={cn(styles.status, gateway.online ? styles.statusOk : styles.statusOff)}
            >
              {gateway.online ? 'в сети' : 'не в сети'}
            </span>
            {`· ${statusDetail(gateway.statusLabel)}`}
          </p>
        </div>
        <button
          type="button"
          className={styles.btnDanger}
          onClick={wrap(() => model.confirm.set({ kind: 'revokeGateway', gatewayId: gateway.id }))}
        >
          Отозвать
        </button>
      </div>
    )
  },
  'GatewayItem',
)

const ProfileLine = reatomMemo<ModelProps & { hardwareId: string; profile: ProfileRow }>(
  ({ model, hardwareId, profile }) => {
    const confirm = model.confirm()
    const revealed = model.revealed()
    const testId = `hardware-profile-${hardwareId}-${profile.index}`
    const name = (
      <p className={styles.profileName}>
        Профиль {profile.index} <span>· {profile.mine ? 'ваш' : 'другой аккаунт'}</span>
      </p>
    )

    // Review focus 4: other accounts' profiles never get the code or the unbind buttons.
    if (!profile.mine) {
      return (
        <div className={styles.profile} data-testid={testId}>
          {name}
        </div>
      )
    }
    if (
      confirm?.kind === 'unbind' &&
      confirm.hardwareId === hardwareId &&
      confirm.index === profile.index
    ) {
      return (
        <div data-testid={testId}>
          <ModelConfirmRow model={model} text={unbindText(profile.index)} confirmLabel="Отвязать" />
        </div>
      )
    }
    if (revealed?.hardwareId === hardwareId && revealed.index === profile.index) {
      return (
        <div className={styles.profile} data-testid={testId}>
          {name}
          <span className={styles.code} data-testid="hardware-code">
            {revealed.consentCode}
          </span>
          <button
            type="button"
            className={styles.link}
            data-testid="hardware-code-hide"
            onClick={wrap(() => model.hideCode())}
          >
            Скрыть
          </button>
        </div>
      )
    }
    return (
      <div className={styles.profile} data-testid={testId}>
        {name}
        <button
          type="button"
          className={styles.link}
          disabled={!model.revealCode.ready()}
          onClick={wrap(() => {
            void model.revealCode(hardwareId, profile.index)
          })}
        >
          Код согласия
        </button>
        <button
          type="button"
          className={cn(styles.link, styles.linkDanger)}
          onClick={wrap(() =>
            model.confirm.set({ kind: 'unbind', hardwareId, index: profile.index }),
          )}
        >
          Отвязать
        </button>
      </div>
    )
  },
  'ProfileLine',
)

export type CardMode = 'attached' | 'detached' | 'returnable'

export type HardwareCardProps = ModelProps & {
  row: HardwareRow
  mode: CardMode
  /** `returnable` only: the button that gives the scale back to its gateway. */
  action?: { label: string; disabled: boolean; onClick: () => void }
  /** `attached` only: «Подключить профиль» when the account has no profile on this scale. */
  onConnectProfile?: (hardwareId: string) => void
}

function CardSub({ row, mode }: { row: HardwareRow; mode: CardMode }) {
  const reading = row.lastReadingLabel
  if (mode === 'detached') {
    return (
      <p className={styles.rowSub}>
        <span className={cn(styles.status, styles.statusOff)}>без шлюза</span>
        {`· ${reading}`}
      </p>
    )
  }
  if (mode === 'returnable') return <p className={styles.rowSub}>сопряжены с этим шлюзом</p>
  if (row.batteryLabel === null) return <p className={styles.rowSub}>{reading}</p>
  if (!row.batteryLow) return <p className={styles.rowSub}>{`${row.batteryLabel} · ${reading}`}</p>
  return (
    <p className={styles.rowSub}>
      <span className={styles.low}>
        <TriangleAlert size={13} strokeWidth={2} aria-hidden />
        {row.batteryLabel}
      </span>
      {`· ${reading}`}
    </p>
  )
}

export const HardwareCard = reatomMemo<HardwareCardProps>(
  ({ model, row, mode, action, onConnectProfile }) => {
    const confirm = model.confirm()
    const online = mode === 'attached' && row.gatewayOnline
    const confirmingKind =
      (confirm?.kind === 'unpair' || confirm?.kind === 'removeDetached') &&
      confirm.hardwareId === row.id
        ? confirm.kind
        : null

    const button =
      mode === 'attached' ? (
        online ? (
          <button
            type="button"
            className={styles.btnDanger}
            onClick={wrap(() => model.confirm.set({ kind: 'unpair', hardwareId: row.id }))}
          >
            Отключить
          </button>
        ) : null
      ) : mode === 'detached' ? (
        <button
          type="button"
          className={styles.btnDanger}
          onClick={wrap(() => model.confirm.set({ kind: 'removeDetached', hardwareId: row.id }))}
        >
          Убрать
        </button>
      ) : action === undefined ? null : (
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={action.disabled}
          onClick={wrap(action.onClick)}
        >
          {action.label}
        </button>
      )

    return (
      <div
        className={cn(styles.card, mode !== 'attached' && styles.cardDashed)}
        data-testid={`hardware-scale-${row.id}`}
        data-mode={mode}
      >
        {confirmingKind === null ? (
          <div className={styles.row}>
            <div className={cn(styles.tile, online && styles.tileOn)}>
              <Scale size={18} strokeWidth={1.8} aria-hidden />
            </div>
            <div className={styles.rowBody}>
              <p className={styles.rowTitle}>{row.title}</p>
              <CardSub row={row} mode={mode} />
            </div>
            {button}
          </div>
        ) : (
          <ModelConfirmRow
            model={model}
            text={confirmingKind === 'unpair' ? unpairText(row.title) : removeText(row.title)}
            confirmLabel={confirmingKind === 'unpair' ? 'Отключить' : 'Убрать'}
          />
        )}
        {mode === 'attached' && row.batteryLow ? (
          <div className={styles.lowRow} role="note">
            <TriangleAlert size={15} strokeWidth={2} aria-hidden />
            <span>{LOW_BATTERY_NOTE}</span>
          </div>
        ) : null}
        {row.profiles.map((profile) =>
          mode === 'returnable' ? (
            <div
              key={profile.index}
              className={cn(styles.profile, styles.profileMuted)}
              data-testid={`hardware-profile-${row.id}-${profile.index}`}
            >
              <p className={styles.profileName}>
                Профиль {profile.index} <span>· {profile.mine ? 'ваш' : 'другой аккаунт'}</span>
              </p>
            </div>
          ) : (
            <ProfileLine key={profile.index} model={model} hardwareId={row.id} profile={profile} />
          ),
        )}
        {mode === 'attached' && !row.hasMine ? (
          <div className={styles.profile}>
            <p className={cn(styles.profileName, styles.profileMuted)}>
              Ваших взвешиваний с этих весов нет
            </p>
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={!row.gatewayOnline}
              onClick={wrap(() => onConnectProfile?.(row.id))}
            >
              Подключить профиль
            </button>
          </div>
        ) : null}
      </div>
    )
  },
  'HardwareCard',
)

export const AdoptableCard = reatomMemo<ModelProps & { row: AdoptRow; gatewayOnline: boolean }>(
  ({ model, row, gatewayOnline }) => (
    <div
      className={cn(styles.card, styles.cardDashed)}
      data-testid={`hardware-adoptable-${row.gatewayId}-${row.address}`}
    >
      <div className={styles.row}>
        <div className={styles.tile}>
          <Scale size={18} strokeWidth={1.8} aria-hidden />
        </div>
        <div className={styles.rowBody}>
          <p className={styles.rowTitle}>{row.title}</p>
          <p className={styles.rowSub}>на этой борде ещё не добавлены</p>
        </div>
        <button
          type="button"
          className={styles.btnPrimary}
          disabled={!gatewayOnline || !model.adopt.ready()}
          onClick={wrap(() => {
            void model.adopt(row.gatewayId, row.address)
          })}
        >
          Добавить
        </button>
      </div>
    </div>
  ),
  'AdoptableCard',
)
