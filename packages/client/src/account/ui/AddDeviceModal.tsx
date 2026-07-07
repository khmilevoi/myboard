import { wrap } from '@reatom/core'
import { AlertTriangle, Check, CircleAlert, Link2, Loader2, ShieldCheck, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect } from 'react'
import { cn } from 'widget-sdk/lib/utils'
import { reatomMemo } from 'widget-sdk/reatom/reatom-memo'

import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog'

import type { AddDeviceModel } from '../model/add-device-model'
import { DeviceIcon } from './MyDevicesDialog'

import styles from './AddDeviceModal.module.css'

export type AddDeviceModalProps = {
  model: AddDeviceModel
  open: boolean
  onOpenChange: (open: boolean) => void
}

// No existing clipboard helper elsewhere in this codebase (this is the first
// consumer) -- the Clipboard API can be unavailable/denied (insecure
// context, permissions), and the design has no fallback affordance for that
// case, so a failure is silently swallowed rather than surfaced.
async function copyLink(url: string | null): Promise<void> {
  if (!url) return
  try {
    await navigator.clipboard.writeText(url)
  } catch {
    // No design-specified fallback UI for a denied/unavailable clipboard.
  }
}

function ConfirmButtonLabel({ verifying }: { verifying: boolean }) {
  if (verifying) {
    return (
      <>
        <Loader2 size={18} strokeWidth={2} className="animate-spin" aria-hidden />
        Подтверждение…
      </>
    )
  }
  return (
    <>
      <ShieldCheck size={18} strokeWidth={2} aria-hidden />
      Подтвердить
    </>
  )
}

// Panel "3 · Модалка «Добавить устройство» · устройство А" of
// Мультиустройства.dc.html, states (a)-(e):
// (a) confirm identity, (b) QR + code, (c) flips to approval when a
// `device-pending` device arrives (account-model.pending -> this model's
// `pendingDevice`), (d) code expired, (e) device added.
export const AddDeviceModal = reatomMemo<AddDeviceModalProps>(({ model, open, onOpenChange }) => {
  const phase = model.phase()
  const pendingDevice = model.pendingDevice()
  const justApproved = model.justApproved()
  const qrOptions = model.qrOptions()
  const url = model.url()
  const formatted = model.formatted()
  const countdown = model.countdown()
  // Surfaces both `start()`'s ceremony/network failures (idle/verifying,
  // showing/expired states) and `approve()`/`deny()`'s delegate failures
  // (e.g. device-limit-exceeded) near the approval card -- `start()` is a
  // security-relevant fresh-UV WebAuthn ceremony, so a cancelled/failed
  // prompt must not silently revert to a plain button with no feedback.
  const error = model.error()
  // `busy` covers either action being in flight -- `pendingDevice` stays
  // non-null until the delegate call completes and account-model.refresh()
  // removes it, so both buttons need disabling regardless of which one
  // was clicked.
  const approving = model.busy()

  // A ref *callback* (not useRef+useEffect(mount-only)) because the QR
  // container div only exists while phase === 'showing' -- it mounts and
  // unmounts as the flow moves in and out of that phase, so `.append()`
  // must re-run every time a fresh container node appears, not just once
  // per AddDeviceModal instance.
  const handleQrContainer = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) model.qrCode.append(node)
    },
    [model],
  )

  useEffect(() => {
    if (qrOptions == null) return
    model.qrCode.update(qrOptions)
    // Only the QR's actual data/color should trigger a DOM refresh --
    // `qrOptions` is a plain object literal recreated by the model's own
    // computed, not something whose *reference* identity view code should
    // depend on (that would re-run this every render, e.g. every
    // countdown tick).
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOptions?.data, qrOptions?.dotsOptions?.color])

  let heading: string
  let icon: ReactNode = null
  let body: ReactNode

  if (pendingDevice != null) {
    heading = 'Устройство хочет присоединиться'
    body = (
      <>
        <div className={styles.approvalRow}>
          <div className={styles.approvalIcon}>
            <DeviceIcon label={pendingDevice.label} />
          </div>
          <div className={styles.approvalLabel}>{pendingDevice.label}</div>
        </div>
        <div className={styles.approvalActions}>
          <button
            type="button"
            disabled={approving}
            className={styles.denyButton}
            onClick={wrap(() => {
              void model.deny()
            })}
          >
            Отклонить
          </button>
          <button
            type="button"
            disabled={approving}
            className={styles.approveButton}
            onClick={wrap(() => {
              void model.approve()
            })}
          >
            Подтвердить
          </button>
        </div>
      </>
    )
  } else if (justApproved != null) {
    heading = 'Устройство добавлено'
    icon = (
      <div className={cn(styles.iconCircle, styles.iconCircleSuccess)}>
        <Check size={24} strokeWidth={2.4} aria-hidden />
      </div>
    )
    body = <p className={styles.description}>{justApproved.label} теперь может входить в аккаунт</p>
  } else if (phase === 'showing') {
    heading = 'Добавить устройство'
    body = (
      <>
        <p className={styles.description}>
          Отсканируйте код на новом устройстве или отправьте ссылку
        </p>
        <div className={styles.qrChip} ref={handleQrContainer} />
        <div className={styles.code}>{formatted}</div>
        <button
          type="button"
          className={styles.copyButton}
          onClick={wrap(() => {
            void copyLink(url)
          })}
        >
          <Link2 size={15} strokeWidth={2} aria-hidden />
          Скопировать ссылку
        </button>
        <div className={styles.countdown}>Код активен ещё {countdown}</div>
      </>
    )
  } else if (phase === 'expired') {
    heading = 'Срок действия кода истёк'
    icon = (
      <div className={cn(styles.iconCircle, styles.iconCircleDanger)}>
        <CircleAlert size={24} strokeWidth={2} aria-hidden />
      </div>
    )
    body = (
      <>
        <p className={styles.description}>Создайте новый код, чтобы продолжить подключение</p>
        <button
          type="button"
          className={styles.retryButton}
          onClick={wrap(() => {
            void model.start()
          })}
        >
          Создать новый код
        </button>
      </>
    )
  } else {
    // 'idle' | 'verifying' -- design state (a), confirm identity.
    const verifying = phase === 'verifying'
    heading = 'Подтвердите личность, чтобы создать код'
    body = (
      <>
        <p className={styles.description}>
          Это нужно, чтобы никто другой не мог добавить устройство от вашего имени.
        </p>
        <button
          type="button"
          disabled={verifying}
          className={styles.confirmButton}
          onClick={wrap(() => {
            void model.start()
          })}
        >
          <ConfirmButtonLabel verifying={verifying} />
        </button>
      </>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.content} overlayClassName={styles.overlay}>
        <DialogClose asChild>
          <button type="button" aria-label="Закрыть" className={styles.close}>
            <X size={15} strokeWidth={2} aria-hidden />
          </button>
        </DialogClose>
        {icon}
        <DialogTitle className={cn(styles.heading, icon != null && styles.headingWithIcon)}>
          {heading}
        </DialogTitle>
        {body}
        {error ? (
          <div role="alert" className={styles.error}>
            <AlertTriangle size={14} strokeWidth={2.2} className={styles.errorIcon} aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}, 'AddDeviceModal')
