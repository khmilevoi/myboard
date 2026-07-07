import { atom, wrap } from '@reatom/core'
import { CircleAlert, Monitor, Plus, Smartphone, X } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

import { type AccountModel, createAccountModel } from '../model/account-model'
import { pluralize } from './AccountMenu'

import styles from './MyDevicesDialog.module.css'

export type MyDevicesDialogProps = {
  /**
   * Injectable for tests/standalone use; defaults to a fresh
   * `createAccountModel()` instance -- mirrors AccountMenu.tsx's own
   * `modelOverride ?? createAccountModel()` convention. In the real app,
   * AccountMenu.tsx always passes its own already-refreshing `model`
   * instance explicitly, so this default never actually runs there: this
   * dialog must never own a second, independently-fetching `AccountModel`
   * alongside AccountMenu's.
   */
  model?: AccountModel
  open: boolean
  onOpenChange: (open: boolean) => void
}

const DAY_MS = 24 * 60 * 60 * 1000
const MOBILE_LABEL_PATTERN = /iphone|ipad|ipod|ios|android/i

function daysBetween(from: number, to: number): number {
  return Math.floor((to - from) / DAY_MS)
}

// "Добавлено ..." label for a device row, mirroring the design's three
// example strings ("сегодня" / "N дня/дней назад" / "N недели/недель назад").
// Clamped at 0 so a `createdAt` slightly ahead of `now` (clock skew) still
// reads as "today" instead of a negative count.
function formatAddedAt(createdAt: number, now: number): string {
  const days = Math.max(0, daysBetween(createdAt, now))
  if (days === 0) return 'Добавлено сегодня'
  if (days < 7) return `Добавлено ${days} ${pluralize(days, 'день', 'дня', 'дней')} назад`
  const weeks = Math.floor(days / 7)
  return `Добавлено ${weeks} ${pluralize(weeks, 'неделя', 'недели', 'недель')} назад`
}

// "хочет присоединиться · ..." label for a pending row. The design only
// shows "только что"; the minute/hour tiers below are a reasonable extension
// for requests left pending longer, falling back to formatAddedAt's day/week
// wording (stripped of its "Добавлено " prefix) for anything a day or older.
function formatPendingAge(createdAt: number, now: number): string {
  const elapsedMs = Math.max(0, now - createdAt)
  if (elapsedMs < 60_000) return 'только что'
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60) return `${minutes} ${pluralize(minutes, 'минуту', 'минуты', 'минут')} назад`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${pluralize(hours, 'час', 'часа', 'часов')} назад`
  return formatAddedAt(createdAt, now).replace('Добавлено ', '')
}

function DeviceIcon({ label, className }: { label: string; className?: string }) {
  const Icon = MOBILE_LABEL_PATTERN.test(label) ? Smartphone : Monitor
  return <Icon size={17} strokeWidth={1.8} className={className} aria-hidden />
}

export const MyDevicesDialog = reatomMemo<MyDevicesDialogProps>(
  ({ model: modelOverride, open, onOpenChange }) => {
    const [model] = useState(() => modelOverride ?? createAccountModel())
    // Component-scoped confirm state for the two-click revoke flow (design
    // state (d)) -- same lazy-`useState(() => atom(...))` idiom AccountMenu.tsx
    // uses for its own local, ephemeral UI atoms.
    const [confirmingId] = useState(() =>
      atom<string | null>(null, 'myDevicesDialog.confirmingRevokeId'),
    )
    // Stub open-state atom for Task B6's AddDeviceModal -- the "Добавить
    // устройство" button flips this to true; nothing reads it yet. Same
    // "write-only stub" pattern AccountMenu.tsx (Task B4) left for this
    // dialog's own open state, one level down.
    const [addDeviceOpen] = useState(() => atom(false, 'myDevicesDialog.addDeviceOpen'))

    const account = model.account()
    const devices = model.devices()
    const pending = model.pending()
    const thisCredentialId = model.thisCredentialId()
    const confirming = confirmingId()

    const activeDevices = devices.filter((device) => device.status === 'active')
    const limitReached = account != null && activeDevices.length >= account.deviceLimit
    const now = Date.now()

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className={styles.content} overlayClassName={styles.overlay}>
          <div className={styles.header}>
            <div>
              <DialogTitle className={styles.title}>Мои устройства</DialogTitle>
              <div className={styles.subtitle}>{account?.name}</div>
            </div>
            <DialogClose asChild>
              <button type="button" aria-label="Закрыть" className={styles.close}>
                <X size={16} strokeWidth={2} aria-hidden />
              </button>
            </DialogClose>
          </div>

          {pending.length > 0 ? (
            <>
              <div className={styles.sectionLabel}>Ожидают подтверждения</div>
              <div className={styles.pendingList}>
                {pending.map((device) => (
                  <div key={device.credentialId} className={styles.pendingRow}>
                    <div className={styles.pendingIcon}>
                      <DeviceIcon label={device.label} />
                    </div>
                    <div className={styles.rowBody}>
                      <div className={styles.rowLabel}>{device.label}</div>
                      <div className={styles.rowSub}>
                        хочет присоединиться · {formatPendingAge(device.createdAt, now)}
                      </div>
                    </div>
                    <div className={styles.pendingActions}>
                      <button
                        type="button"
                        className={styles.denyButton}
                        onClick={wrap(() => {
                          void model.deny(device.credentialId)
                        })}
                      >
                        Отклонить
                      </button>
                      <button
                        type="button"
                        className={styles.approveButton}
                        onClick={wrap(() => {
                          void model.approve(device.credentialId)
                        })}
                      >
                        Подтвердить
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : null}

          <div className={cn(styles.sectionLabel, pending.length > 0 && styles.sectionLabelTight)}>
            Ваши устройства
          </div>
          <div>
            {activeDevices.map((device, index) => {
              const isCurrent = device.credentialId === thisCredentialId
              const isLast = index === activeDevices.length - 1

              if (confirming === device.credentialId) {
                return (
                  <div key={device.credentialId} className={styles.confirmRow}>
                    <div className={styles.confirmHead}>
                      <div className={cn(styles.icon, styles.confirmIcon)}>
                        <DeviceIcon label={device.label} />
                      </div>
                      <div className={styles.rowBody}>
                        <div className={styles.rowLabel}>{device.label}</div>
                        <div className={styles.rowSub}>{formatAddedAt(device.createdAt, now)}</div>
                      </div>
                    </div>
                    <div className={styles.confirmText}>
                      Отозвать это устройство? Оно потеряет доступ.
                    </div>
                    <div className={styles.confirmActions}>
                      <button
                        type="button"
                        className={styles.cancelButton}
                        onClick={wrap(() => confirmingId.set(null))}
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        className={styles.confirmRevokeButton}
                        onClick={wrap(() => {
                          void model.revoke(device.credentialId)
                          confirmingId.set(null)
                        })}
                      >
                        Отозвать
                      </button>
                    </div>
                  </div>
                )
              }

              return (
                <div
                  key={device.credentialId}
                  className={cn(styles.row, !isLast && styles.rowBordered)}
                >
                  <div className={styles.icon}>
                    <DeviceIcon label={device.label} />
                  </div>
                  <div className={styles.rowBody}>
                    <div className={styles.rowLabelLine}>
                      <span className={styles.rowLabel}>{device.label}</span>
                      {isCurrent ? <span className={styles.chip}>Это устройство</span> : null}
                    </div>
                    <div className={styles.rowSub}>{formatAddedAt(device.createdAt, now)}</div>
                  </div>
                  {/* Never rendered for the current device: mirrors the
                      server's LastActiveDeviceError guard (revoking the sole
                      active device is always rejected), and since the caller
                      is always authenticated via an active device, that sole
                      active device is always this one -- the design itself
                      never shows a revoke action on the "Это устройство" row
                      in any of its 5 states, current-vs-others or otherwise. */}
                  {isCurrent ? null : (
                    <button
                      type="button"
                      className={styles.revokeButton}
                      onClick={wrap(() => confirmingId.set(device.credentialId))}
                    >
                      Отозвать
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          {limitReached ? (
            <div className={styles.limitNote}>
              <CircleAlert size={15} strokeWidth={2.1} className={styles.limitIcon} aria-hidden />
              <span>Достигнут лимит устройств</span>
            </div>
          ) : null}

          <button
            type="button"
            disabled={limitReached}
            className={cn(
              styles.addButton,
              limitReached && styles.addButtonDisabled,
              !limitReached && confirming != null && styles.addButtonDimmed,
            )}
            onClick={wrap(() => addDeviceOpen.set(true))}
          >
            <Plus size={17} strokeWidth={2.3} aria-hidden />
            Добавить устройство
          </button>
        </DialogContent>
      </Dialog>
    )
  },
  'MyDevicesDialog',
)
